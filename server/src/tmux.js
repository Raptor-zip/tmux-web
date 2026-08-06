import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const execFileAsync = promisify(execFile);

/** tmux の -F フォーマット用の区切り文字（通常のテキストにまず現れない制御文字） */
const SEP = '\x1f';

export const TMUX_BIN = process.env.TMUX_WEB_TMUX_BIN || 'tmux';

/** tmux サーバに渡す共通引数（-L / -S でソケットを切り替えられるようにする） */
function baseArgs() {
  const args = [];
  if (process.env.TMUX_WEB_SOCKET_NAME) args.push('-L', process.env.TMUX_WEB_SOCKET_NAME);
  if (process.env.TMUX_WEB_SOCKET_PATH) args.push('-S', process.env.TMUX_WEB_SOCKET_PATH);
  return args;
}

export class TmuxError extends Error {
  constructor(message, { args, stderr, code } = {}) {
    super(message);
    this.name = 'TmuxError';
    this.args = args;
    this.stderr = stderr;
    this.code = code;
  }
}

/**
 * tmux コマンドを shell を介さずに実行する。
 * 引数は配列で渡すため、セッション名などにメタ文字が含まれていても安全。
 */
export async function tmux(args, { allowFailure = false } = {}) {
  const full = [...baseArgs(), ...args];
  try {
    const { stdout } = await execFileAsync(TMUX_BIN, full, {
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, TMUX: '' }, // 入れ子実行を避ける
    });
    return stdout;
  } catch (err) {
    const stderr = (err.stderr || '').trim();
    if (allowFailure) return null;
    throw new TmuxError(stderr || err.message, {
      args: full,
      stderr,
      code: err.code,
    });
  }
}

/** -F フォーマット付きで実行し、行 × フィールドの二次元配列にして返す */
async function query(args, fields) {
  const format = fields.map((f) => `#{${f}}`).join(SEP);
  const out = await tmux([...args, '-F', format], { allowFailure: true });
  if (out == null) return [];
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(SEP);
      const row = {};
      fields.forEach((f, i) => {
        row[f] = parts[i] ?? '';
      });
      return row;
    });
}

const num = (v) => (v === '' || v == null ? 0 : Number(v));
const bool = (v) => v === '1';

/**
 * 端末タイトルの先頭に付く状態マークを落として、本文だけを取り出す。
 *
 * CLI ツールは作業中を点字ブロック (U+2800-28FF) のスピナーで示すことが多く、
 * これが毎フレーム変わるせいで「タイトルが変化し続けている」と誤検知してしまう。
 * 落としたマークが点字スピナーなら「動いている」とみなす。
 */
const STATUS_PREFIX = /^[\s⠀-⣿✱✻✽✳●○•·*+\-|/\\]+/;
const SPINNER = /[⠁-⣿]/;

// タイトルを設定していないシェルは pane_title がホスト名になる。中身が無いのと同じ。
const HOSTNAME = os.hostname().toLowerCase();
const HOSTNAME_SHORT = HOSTNAME.split('.')[0];

function splitTitle(raw) {
  const mark = raw.match(STATUS_PREFIX)?.[0] ?? '';
  const title = raw.slice(mark.length).trim();
  const lower = title.toLowerCase();
  return {
    title: lower === HOSTNAME || lower === HOSTNAME_SHORT ? '' : title,
    busy: SPINNER.test(mark),
  };
}

// ---------------------------------------------------------------------------
// 読み取り
// ---------------------------------------------------------------------------

export async function listSessions() {
  const rows = await query(
    ['list-sessions'],
    [
      'session_id',
      'session_name',
      'session_windows',
      'session_created',
      'session_attached',
      'session_group',
      'session_group_size',
      'session_path',
      'session_activity',
    ],
  );
  return rows.map((r) => ({
    id: r.session_id,
    name: r.session_name,
    windows: num(r.session_windows),
    created: num(r.session_created) * 1000,
    activity: num(r.session_activity) * 1000,
    attached: num(r.session_attached),
    group: r.session_group || null,
    groupSize: num(r.session_group_size),
    path: r.session_path,
  }));
}

export async function listWindows() {
  const rows = await query(
    ['list-windows', '-a'],
    [
      'session_id',
      'session_name',
      'window_id',
      'window_index',
      'window_name',
      'window_active',
      'window_panes',
      'window_layout',
      'window_zoomed_flag',
      'window_activity_flag',
      'window_bell_flag',
      'window_width',
      'window_height',
    ],
  );
  return rows.map((r) => ({
    id: r.window_id,
    sessionId: r.session_id,
    sessionName: r.session_name,
    index: num(r.window_index),
    name: r.window_name,
    active: bool(r.window_active),
    panes: num(r.window_panes),
    layout: r.window_layout,
    zoomed: bool(r.window_zoomed_flag),
    activity: bool(r.window_activity_flag),
    bell: bool(r.window_bell_flag),
    width: num(r.window_width),
    height: num(r.window_height),
  }));
}

export async function listPanes() {
  const rows = await query(
    ['list-panes', '-a'],
    [
      'session_id',
      'window_id',
      'pane_id',
      'pane_index',
      'pane_active',
      'pane_title',
      'pane_current_command',
      'pane_current_path',
      'pane_pid',
      'pane_width',
      'pane_height',
      'pane_left',
      'pane_top',
      'pane_dead',
      'pane_in_mode',
    ],
  );
  return rows.map((r) => ({
    id: r.pane_id,
    sessionId: r.session_id,
    windowId: r.window_id,
    index: num(r.pane_index),
    active: bool(r.pane_active),
    ...splitTitle(r.pane_title),
    command: r.pane_current_command,
    path: r.pane_current_path,
    pid: num(r.pane_pid),
    width: num(r.pane_width),
    height: num(r.pane_height),
    left: num(r.pane_left),
    top: num(r.pane_top),
    dead: bool(r.pane_dead),
    inMode: bool(r.pane_in_mode),
  }));
}

/** UI が 1 回のリクエストで必要とする全状態 */
export async function snapshot() {
  const [sessions, windows, panes] = await Promise.all([
    listSessions(),
    listWindows(),
    listPanes(),
  ]);
  return { sessions, windows, panes, ts: Date.now() };
}

export async function capturePane(target, { lines = 2000, escapes = true } = {}) {
  const args = ['capture-pane', '-p', '-t', target, '-J', '-S', String(-Math.abs(lines))];
  if (escapes) args.push('-e');
  const out = await tmux(args, { allowFailure: true });
  return out ?? '';
}

/** ユーザーの .tmux.conf 由来の実際のキーバインドを返す（チートシート用） */
export async function listKeys(table = 'prefix') {
  const out = await tmux(['list-keys', '-T', table], { allowFailure: true });
  if (!out) return [];
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      // 例: bind-key    -T prefix c    new-window
      const m = line.match(/^bind-key\s+(?:-r\s+)?-T\s+(\S+)\s+(\S+)\s+(.*)$/);
      if (!m) return null;
      return { table: m[1], key: m[2], command: m[3].trim() };
    })
    .filter(Boolean);
}

export async function serverInfo() {
  const version = (await tmux(['-V'], { allowFailure: true }))?.trim() ?? 'unknown';
  const prefix =
    (await tmux(['show-options', '-gv', 'prefix'], { allowFailure: true }))?.trim() || 'C-b';
  return {
    version,
    prefix,
    socketName: process.env.TMUX_WEB_SOCKET_NAME || 'default',
    home: os.homedir(),
  };
}

// ---------------------------------------------------------------------------
// 書き込み
// ---------------------------------------------------------------------------

export const actions = {
  newSession: ({ name, cwd, command }) => {
    const args = ['new-session', '-d', '-P', '-F', '#{session_id}'];
    if (name) args.push('-s', name);
    if (cwd) args.push('-c', cwd);
    if (command) args.push(command);
    return tmux(args);
  },
  killSession: ({ target }) => tmux(['kill-session', '-t', target]),
  renameSession: ({ target, name }) => tmux(['rename-session', '-t', target, name]),

  newWindow: ({ target, name, cwd, after }) => {
    const args = ['new-window', '-P', '-F', '#{window_id}', '-t', target];
    if (after) args.push('-a');
    if (name) args.push('-n', name);
    if (cwd) args.push('-c', cwd);
    return tmux(args);
  },
  killWindow: ({ target }) => tmux(['kill-window', '-t', target]),
  renameWindow: ({ target, name }) => tmux(['rename-window', '-t', target, name]),
  selectWindow: ({ target }) => tmux(['select-window', '-t', target]),
  moveWindow: ({ target, index }) => tmux(['move-window', '-s', target, '-t', String(index)]),
  nextWindow: ({ target }) => tmux(['next-window', '-t', target]),
  previousWindow: ({ target }) => tmux(['previous-window', '-t', target]),

  splitPane: ({ target, direction = 'vertical', cwd, percent }) => {
    const args = ['split-window', '-P', '-F', '#{pane_id}', '-t', target];
    // tmux の -h は「左右に並べる」= 縦の分割線。UI 側の呼び方に合わせて変換する。
    args.push(direction === 'horizontal' ? '-h' : '-v');
    if (cwd) args.push('-c', cwd);
    if (percent) args.push('-p', String(percent));
    return tmux(args);
  },
  killPane: ({ target }) => tmux(['kill-pane', '-t', target]),
  selectPane: ({ target }) => tmux(['select-pane', '-t', target]),
  zoomPane: ({ target }) => tmux(['resize-pane', '-Z', '-t', target]),
  resizePane: ({ target, direction, amount = 5 }) => {
    const flag = { left: '-L', right: '-R', up: '-U', down: '-D' }[direction];
    if (!flag) throw new TmuxError(`unknown resize direction: ${direction}`);
    return tmux(['resize-pane', flag, String(amount), '-t', target]);
  },
  swapPane: ({ target, direction }) =>
    tmux(['swap-pane', direction === 'up' ? '-U' : '-D', '-t', target]),
  breakPane: ({ target }) => tmux(['break-pane', '-t', target]),
  joinPane: ({ source, target, direction = 'vertical' }) =>
    tmux(['join-pane', direction === 'horizontal' ? '-h' : '-v', '-s', source, '-t', target]),
  setLayout: ({ target, layout }) => tmux(['select-layout', '-t', target, layout]),
  respawnPane: ({ target }) => tmux(['respawn-pane', '-k', '-t', target]),

  /** keys: 文字列配列。literal=true なら -l でそのまま送る */
  sendKeys: ({ target, keys, literal = false }) => {
    const list = Array.isArray(keys) ? keys : [keys];
    const args = ['send-keys', '-t', target];
    if (literal) args.push('-l');
    return tmux([...args, '--', ...list]);
  },
  /** シェルにコマンドを打ち込んで Enter を押す */
  runCommand: async ({ target, command }) => {
    await tmux(['send-keys', '-t', target, '-l', '--', command]);
    return tmux(['send-keys', '-t', target, 'Enter']);
  },
  clearPane: ({ target }) => tmux(['send-keys', '-t', target, '-R', 'C-l']),

  setOption: ({ target, name, value, global: isGlobal }) => {
    const args = ['set-option'];
    if (isGlobal) args.push('-g');
    if (target) args.push('-t', target);
    args.push(name, value);
    return tmux(args);
  },
};

export function isKnownAction(name) {
  return Object.prototype.hasOwnProperty.call(actions, name);
}
