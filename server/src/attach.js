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
 *   ウィンドウ・ペインは共有されるが「今どのウィンドウを見ているか」と端末サイズは
 *   ブラウザ側で独立するので、ユーザーが端末で開いている tmux の表示を乱さない。
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

  let attachTarget = target.id;
  let mirrorName = null;

  if (mode === 'mirror') {
    mirrorName = `${MIRROR_PREFIX}${process.pid}-${++counter}`;
    // -t でグループを指定すると、ウィンドウを共有する別セッションが作られる
    await tmux(['new-session', '-d', '-s', mirrorName, '-t', target.name]);
    await tmux(['set-option', '-t', mirrorName, 'status', showStatusBar ? 'on' : 'off'], {
      allowFailure: true,
    });
    await tmux(['set-option', '-t', mirrorName, 'aggressive-resize', 'on'], {
      allowFailure: true,
    });
    attachTarget = mirrorName;
  }

  if (windowId) {
    const windows = await listWindows();
    const win = windows.find((w) => w.id === windowId);
    if (win) {
      const sel = mirrorName ? `${mirrorName}:${win.index}` : windowId;
      await tmux(['select-window', '-t', sel], { allowFailure: true });
    }
  }

  const child = pty.spawn(TMUX_BIN, [...socketArgs(), 'attach-session', '-t', attachTarget], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: target.path || process.env.HOME,
    env: {
      ...process.env,
      TMUX: '',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    try {
      child.kill();
    } catch {
      /* すでに終了している */
    }
    if (mirrorName) {
      await tmux(['kill-session', '-t', mirrorName], { allowFailure: true });
    }
  };

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
