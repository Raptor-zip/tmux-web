import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { WebSocketServer } from 'ws';

const exec = promisify(execFile);
const MAX_BUFFER = 8 * 1024 * 1024;

export async function probeDesktop() {
  const display = process.env.TMUX_WEB_DISPLAY || process.env.DISPLAY;
  if (!display) throw new Error('X11 にログインし、DISPLAY / XAUTHORITY をサービスに引き継いでください。Wayland は未対応です。');
  const env = { ...process.env, DISPLAY: display };
  try { await exec('x11vnc', ['-version'], { env, timeout: 3000 }); }
  catch { throw new Error('リモート操作には x11vnc が必要です。sudo apt install x11vnc x11-xserver-utils で導入してください。'); }
  let stdout;
  try { ({ stdout } = await exec('xrandr', ['--current'], { env, timeout: 3000 })); }
  catch { throw new Error('X11 に接続できません。DISPLAY / XAUTHORITY とログイン状態を確認してください。'); }
  const match = stdout.match(/current\s+(\d+)\s+x\s+(\d+)/);
  if (!match) throw new Error('デスクトップの解像度を取得できません。');
  return { display, width: Number(match[1]), height: Number(match[2]), env };
}

/** 認証済み WebSocket と、0700 のディレクトリ内の VNC ソケットを中継する。
 * VNC の TCP ポートは開かない。切断・起動失敗・終了時は子プロセスも片付ける。
 */
export function createDesktop({ probe = probeDesktop, spawnVnc = spawn } = {}) {
  const sessions = new Set();
  let disposed = false;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });

  async function connect(ws) {
    let child, tcp, directory, retry, timer, closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      sessions.delete(cleanup);
      clearTimeout(timer); clearTimeout(retry);
      tcp?.destroy();
      if (child) {
        const proc = child;
        proc.kill('SIGTERM');
        const killTimer = setTimeout(() => proc.kill('SIGKILL'), 1500);
        killTimer.unref();
        // Remove socket files only after the process stops using them.
        proc.once('close', () => { clearTimeout(killTimer); if (directory) void rm(directory, { recursive: true, force: true }); });
        if (proc.exitCode !== null && proc.exitCode !== undefined && directory) void rm(directory, { recursive: true, force: true });
      } else if (directory) void rm(directory, { recursive: true, force: true });
      if (ws.readyState === ws.OPEN) ws.close(1000);
    };
    const fail = (reason) => { if (ws.readyState === ws.OPEN) ws.close(1011, Buffer.from(String(reason)).subarray(0, 120).toString('utf8')); cleanup(); };
    sessions.add(cleanup);
    ws.once('close', cleanup);
    ws.once('error', cleanup);
    // Register immediately so a client cannot send unbounded input while starting.
    ws.on('message', (data, binary) => {
      if (!binary || !tcp || tcp.connecting) { fail('デスクトップ接続の準備ができていません'); return; }
      if (tcp.writableLength + data.length > MAX_BUFFER) { fail('入力データが多すぎます'); return; }
      if (!tcp.write(data)) ws.pause();
    });
    try {
      const config = await probe();
      if (closed) return;
      directory = await mkdtemp(path.join(tmpdir(), 'tmux-desktop-'));
      if (closed) { await rm(directory, { recursive: true, force: true }); return; }
      const socketPath = path.join(directory, 'vnc');
      child = spawnVnc('x11vnc', [
        '-norc', '-display', config.display, '-unixsock', socketPath,
        '-rfbport', '0', '-timeout', '15', '-no6', '-nopw', '-once', '-shared', '-quiet', '-safer',
        '-xkb', '-repeat', '-xrandr', 'resize',
        '-nowf', '-noscr', '-wait', '20', '-defer', '10',
      ], { env: config.env, stdio: ['ignore', 'ignore', 'pipe'] });
      child.stderr.resume();
      child.once('error', () => fail('x11vnc を起動できませんでした'));
      child.once('close', () => fail('デスクトップ配信が終了しました。再接続してください'));
      timer = setTimeout(() => fail('デスクトップへの接続がタイムアウトしました'), 10000);
      const attempt = () => {
        if (closed) return;
        const candidate = net.createConnection(socketPath);
        tcp = candidate;
        candidate.once('error', (err) => {
          if (closed) return;
          if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') retry = setTimeout(attempt, 50);
          else fail('デスクトップへの接続に失敗しました');
        });
        candidate.once('connect', () => {
          clearTimeout(timer);
          candidate.on('drain', () => ws.resume());
          candidate.on('data', (data) => {
            if (ws.readyState !== ws.OPEN) return;
            if (ws.bufferedAmount > MAX_BUFFER) { fail('配信が追いつきません。再接続してください'); return; }
            candidate.pause();
            ws.send(data, { binary: true }, (err) => { if (err) cleanup(); else candidate.resume(); });
          });
          candidate.once('end', () => fail('デスクトップ配信が切断されました'));
          candidate.once('close', cleanup);
        });
      };
      attempt();
    } catch (err) { fail(err.message); }
  }

  return {
    async status() {
      try { const { width, height } = await probe(); return { available: true, width, height, viewers: sessions.size }; }
      catch (err) { return { available: false, error: err.message, viewers: sessions.size }; }
    },
    upgrade(req, socket, head) {
      if (disposed) return socket.destroy();
      wss.handleUpgrade(req, socket, head, ws => { void connect(ws); });
    },
    dispose() { disposed = true; for (const close of [...sessions]) close(); wss.close(); },
  };
}

// x11vnc versions differ in Unicode clipboard support. Use the X11 clipboard
// directly so Japanese text does not pass through legacy Latin-1 ClientCutText.
export async function readDesktopClipboard() {
  const { env } = await probeDesktop();
  try {
    const { stdout } = await exec('xclip', ['-selection', 'clipboard', '-out'], { env, timeout: 3000, maxBuffer: 1024 * 1024 });
    return stdout;
  } catch { throw new Error('クリップボードを読めません。コピー元と xclip のインストールを確認してください。'); }
}

export async function writeDesktopClipboard(text) {
  const { env } = await probeDesktop();
  await new Promise((resolve, reject) => {
    const proc = spawn('xclip', ['-selection', 'clipboard', '-in'], { env, stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { proc.kill(); reject(new Error('クリップボードへの書き込みがタイムアウトしました')); }, 3000);
    proc.once('error', () => { clearTimeout(timer); reject(new Error('文字の貼り付けには xclip が必要です。sudo apt install xclip で導入してください。')); });
    proc.stdin.on('error', () => {});
    proc.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('クリップボードに書き込めませんでした')); });
    proc.stdin.end(text, 'utf8');
  });
}
