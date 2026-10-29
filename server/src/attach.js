import { fileURLToPath } from 'node:url';
import pty from '@homebridge/node-pty-prebuilt-multiarch';
import { tmux, TMUX_BIN, listWindows, listSessions } from './tmux.js';

let counter = 0;

/** ブラウザ用に作ったミラーセッションかどうかを名前で判定する */
export const MIRROR_PREFIX = 'webmux-';
export const isMirrorSession = (name) => name.startsWith(MIRROR_PREFIX);

function socketArgs() {
  const args = [];
  if (process.env.TMUX_WEB_SOCKET_NAME) args.push('-L', process.env.TMUX_WEB_SOCKET_NAME);
  if (process.env.TMUX_WEB_SOCKET_PATH) args.push('-S', process.env.TMUX_WEB_SOCKET_PATH);
  return args;
}

/**
 * ブラウザのターミナルを tmux につなぐ。
 *
 * mode = 'mirror'（既定）
 *   対象セッションと同じグループの一時セッションを作ってそこに attach する。
 *   ウィンドウ・ペインを共有し、「今どのウィンドウを見ているか」は
 *   ブラウザ側で独立させる。ウィンドウ本体とペインのサイズは
 *   共有されるので、同じウィンドウを異なるサイズで開くと影響し合う。
 *
 * mode = 'direct'
 *   対象セッションに直接 attach する。他のクライアントとサイズを取り合うが、
 *   一時セッションが増えないので tmux の一覧が汚れない。
 */
export async function createAttachment({
  sessionId,
  windowId = null,
  cols = 80,
  rows = 24,
  mode = 'mirror',
  showStatusBar = false,
}) {
  const sessions = await listSessions();
  const target = sessions.find((s) => s.id === sessionId || s.name === sessionId);
  if (!target) throw new Error(`session not found: ${sessionId}`);

  // A tmux reload or plugin can replace the wheel bindings while the server
  // stays alive. Reapply our scrolling policy on every browser attachment.
  // Use the repository copy, so installed config copies cannot go stale.
  if (process.env.TMUX_WEB_MOUSE !== '0') {
    await tmux(['source-file', fileURLToPath(new URL('../../tmux/terminal.conf', import.meta.url))]);
  }

  let attachTarget = target.id;
  let mirrorName = null;
  let mirrorCreated = false;
  let child = null;
  let disposal = null;
  const dispose = () => {
    if (disposal) return disposal;
    disposal = (async () => {
      try { child?.kill(); } catch { /* Already exited. */ }
      if (mirrorCreated) {
        await tmux(['kill-session', '-t', mirrorName], { allowFailure: true });
      }
    })();
    return disposal;
  };

  try {
    if (mode === 'mirror') {
      mirrorName = `${MIRROR_PREFIX}${process.pid}-${++counter}`;
      // -t でグループを指定すると、ウィンドウを共有する別セッションが作られる
      await tmux(['new-session', '-d', '-s', mirrorName, '-t', target.name]);
      mirrorCreated = true;
      await tmux(['set-option', '-t', mirrorName, 'status', showStatusBar ? 'on' : 'off'], {
        allowFailure: true,
      });
      await tmux(['set-option', '-t', mirrorName, 'aggressive-resize', 'on'], {
        allowFailure: true,
      });

      // ブラウザ側だけマウスを有効にする。ミラーはセッション単位なので、端末で開いて
      // いる元セッションの mouse 設定は変わらない。TMUX_WEB_MOUSE=0 で無効にできる。
      if (process.env.TMUX_WEB_MOUSE !== '0') {
        await tmux(['set-option', '-t', mirrorName, 'mouse', 'on'], { allowFailure: true });
      }
      attachTarget = mirrorName;
    }

    // tmux のマウス選択（copy-selection）の結果をブラウザのクリップボードへ渡すには、
    // tmux が OSC 52 をクライアントに送る必要がある。既定の 'external' はアプリ発の
    // OSC 52 を中継するだけで、tmux 自身のコピーは送らないので 'on' にする。
    // set-clipboard はサーバ単位のオプションで、セッションごとには持てない。
    if (process.env.TMUX_WEB_SET_CLIPBOARD !== '0') {
      await tmux(['set-option', '-s', 'set-clipboard', 'on'], { allowFailure: true });
    }

    if (windowId) {
      const windows = await listWindows();
      const win = windows.find((w) => w.id === windowId);
      if (win) {
        const sel = mirrorName ? `${mirrorName}:${win.index}` : windowId;
        await tmux(['select-window', '-t', sel], { allowFailure: true });
      }
    }

    child = pty.spawn(TMUX_BIN, [...socketArgs(), 'attach-session', '-t', attachTarget], {
      name: 'xterm-256color',
      cols,
      rows,
      // This client only connects to tmux. The session's original directory may
      // have moved or disappeared while its panes keep running elsewhere.
      cwd: '/',
      env: {
        ...process.env,
        TMUX: '',
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });
  } catch (error) {
    await dispose().catch(() => {});
    throw error;
  }

  return {
    pty: child,
    mirrorName,
    attachTarget,
    /** ミラーセッション側でウィンドウを切り替える（端末側の表示は変えない） */
    selectWindowIndex: (index) =>
      tmux(['select-window', '-t', `${mirrorName ?? target.name}:${index}`], {
        allowFailure: true,
      }),
    dispose,
  };
}

/** 前回のプロセスが残した孤児ミラーセッションを掃除する */
export async function cleanupOrphanMirrors() {
  const sessions = await listSessions();
  const orphans = sessions.filter(
    (s) => isMirrorSession(s.name) && s.attached === 0,
  );
  for (const s of orphans) {
    await tmux(['kill-session', '-t', s.id], { allowFailure: true });
  }
  return orphans.map((s) => s.name);
}
