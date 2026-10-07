import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const BOUNDARY = 'tmux-screen';
const MAX_FRAME = 8 * 1024 * 1024;

export async function probeDesktop() {
  const display = process.env.TMUX_WEB_DISPLAY || process.env.DISPLAY;
  if (!display) throw new Error('デスクトップに接続できません。X11 にログインし、サービスへ DISPLAY と XAUTHORITY を引き継いでください。');
  const env = { ...process.env, DISPLAY: display };
  try { await exec('ffmpeg', ['-version'], { timeout: 3000, env }); }
  catch { throw new Error('画面配信には ffmpeg が必要です。'); }
  let stdout;
  try { ({ stdout } = await exec('xrandr', ['--current'], { timeout: 3000, env })); }
  catch { throw new Error('X11 の画面に接続できません。DISPLAY / XAUTHORITY とログイン状態を確認してください（Wayland は未対応）。'); }
  const match = stdout.match(/current\s+(\d+)\s+x\s+(\d+)/);
  if (!match) throw new Error('画面サイズを取得できません。');
  const width = Number(match[1]), height = Number(match[2]);
  if (width < 1 || height < 1 || width > 32768 || height > 32768) throw new Error('画面サイズが不正です。');
  return { display, width, height, env };
}

/** 全閲覧者で 1 つのキャプチャを共有。最後の閲覧者が離れたら必ず停止する。 */
export function createScreenCapture({ probe = probeDesktop, spawnCapture = spawn } = {}) {
  const clients = new Set();
  let child = null, starting = null, lastError = null;
  const stop = () => {
    const old = child;
    child = null;
    if (!old) return;
    old.kill('SIGTERM');
    const timer = setTimeout(() => old.kill('SIGKILL'), 1500);
    timer.unref();
    old.once('close', () => clearTimeout(timer));
  };
  const fail = (message, proc) => {
    if (child !== proc) return;
    lastError = message;
    for (const res of clients) {
      if (!res.headersSent) res.status(503).json({ error: message });
      else res.end();
    }
    clients.clear();
    stop();
  };
  const start = async () => {
    if (child) return;
    if (starting) return starting;
    starting = (async () => {
      const config = await probe();
      if (clients.size === 0) return;
      const proc = spawnCapture('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '2',
        '-f', 'x11grab', '-framerate', '6', '-video_size', `${config.width}x${config.height}`,
        '-i', config.display, '-vf', "scale=w='min(1600,iw)':h=-2", '-an',
        '-c:v', 'mjpeg', '-threads', '2', '-q:v', '5', '-f', 'image2pipe', 'pipe:1',
      ], { env: config.env, stdio: ['ignore', 'pipe', 'pipe'] });
      child = proc;
      lastError = null;
      let buffer = Buffer.alloc(0);
      let seenFrame = false;
      const firstFrameTimer = setTimeout(() => fail('画面配信を開始できませんでした。デスクトップのログイン状態を確認してください。', proc), 10000);
      firstFrameTimer.unref();
      proc.once('close', () => clearTimeout(firstFrameTimer));
      proc.stdout.on('data', (data) => {
        if (child !== proc) return;
        buffer = Buffer.concat([buffer, data]);
        if (buffer.length > MAX_FRAME) { fail('画面データのサイズが上限を超えました。', proc); return; }
        // ffmpeg が出力する JPEG は SOI / EOI で区切られる。完全な画像だけを送る。
        let end;
        while ((end = buffer.indexOf(Buffer.from([0xff, 0xd9]))) !== -1) {
          const begin = buffer.indexOf(Buffer.from([0xff, 0xd8]));
          if (begin < 0 || begin > end) { buffer = buffer.subarray(end + 2); continue; }
          const jpeg = buffer.subarray(begin, end + 2);
          buffer = buffer.subarray(end + 2);
          seenFrame = true;
          clearTimeout(firstFrameTimer);
          const frame = Buffer.concat([Buffer.from(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`), jpeg, Buffer.from('\r\n')]);
          for (const res of clients) {
            if (res.destroyed || res.writableLength > 2 * MAX_FRAME) { res.destroy(); clients.delete(res); }
            else res.write(frame);
          }
          if (clients.size === 0) stop();
        }
      });
      proc.stderr.on('data', () => {}); // 排出し続ける。画面に内部パスやログを露出しない。
      proc.once('error', () => fail('ffmpeg を起動できませんでした。', proc));
      proc.once('close', () => fail(seenFrame ? '画面配信が終了しました。再接続してください。' : '画面を取得できませんでした。DISPLAY / XAUTHORITY を確認してください。', proc));
    })();
    try { await starting; } finally { starting = null; }
  };
  return {
    async status() {
      try {
        const { width, height } = await probe();
        return { available: true, width, height, fps: 6, viewers: clients.size, streaming: Boolean(child), error: lastError };
      } catch (err) { return { available: false, error: err.message, viewers: 0, streaming: false }; }
    },
    async subscribe(req, res) {
      res.set({ 'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`, 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
      req.socket.setTimeout(0);
      clients.add(res);
      const remove = () => { clients.delete(res); if (clients.size === 0) stop(); };
      res.once('close', remove);
      try { await start(); }
      catch (err) {
        lastError = err.message;
        remove();
        if (!res.destroyed) res.status(503).json({ error: err.message });
      }
    },
    dispose() { for (const res of clients) res.end(); clients.clear(); stop(); },
  };
}

export function installScreen(app, options) {
  const capture = createScreenCapture(options);
  app.get('/api/screen/status', async (_req, res) => res.json(await capture.status()));
  app.get('/api/screen/stream', (req, res) => { void capture.subscribe(req, res); });
  return capture;
}
