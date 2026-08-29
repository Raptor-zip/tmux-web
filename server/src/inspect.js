/**
 * ペインの「中で何が動いているか」を、端末タイトルではなくプロセスから判定する。
 *
 * 端末タイトルは開いたプロセスが終わっても残る。`✳ 自律的な検証と改善` と出ている
 * ペインの中身が実は素の bash だった、ということが普通に起きる。それだと
 * 「まだエージェントが動いているのか、もう終わっているのか」が一覧から分からない。
 * ここでは pane_pid の子孫を実際に辿って、エージェント／サーバ／その他／空き を決める。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/** 対話型の AI エージェント。名前を出すぶんだけここに載せる */
const AGENTS = {
  claude: 'Claude',
  codex: 'Codex',
  aider: 'Aider',
  gemini: 'Gemini',
  qwen: 'Qwen',
  kimi: 'Kimi',
  crush: 'Crush',
  goose: 'Goose',
  opencode: 'OpenCode',
  'cursor-agent': 'Cursor',
  copilot: 'Copilot',
  droid: 'Droid',
  amp: 'Amp',
};

/** 空きペインとみなすシェル。ログインシェルは argv[0] が `-bash` になる */
const SHELLS = new Set([
  'bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'csh', 'ash', 'nu', 'xonsh', 'elvish',
]);

/** 実体はこの後ろの引数にある、という実行系。`node .../vite` を vite と呼びたい */
const RUNTIMES = new Set([
  'node', 'bun', 'deno', 'python', 'python3', 'ruby', 'perl', 'npx', 'pnpx', 'uv', 'uvx', 'bunx',
]);

const base = (s) => (s || '').split('/').pop() || '';

/** argv からコマンド名を決める。ログインシェルの `-` と実行系のラッパーを剥がす */
function commandName(args) {
  const parts = args.trim().split(/\s+/);
  let name = base(parts[0].replace(/^-/, ''));
  if (RUNTIMES.has(name)) {
    // `node --flag foo.js` のようにフラグが挟まることがある
    const next = parts.slice(1).find((a) => !a.startsWith('-'));
    if (next) name = base(next).replace(/\.(js|mjs|cjs|ts|py|rb)$/, '') || name;
  }
  return name;
}

// ---------------------------------------------------------------------------
// プロセス表
// ---------------------------------------------------------------------------

/** `ps` を 1 回だけ叩いて pid → プロセス、ppid → 子 pid[] を作る */
async function readProcesses() {
  let out;
  try {
    const r = await execFileAsync('ps', ['-eo', 'pid=,ppid=,stat=,etimes=,args='], {
      maxBuffer: 16 * 1024 * 1024,
    });
    out = r.stdout;
  } catch {
    return { procs: new Map(), children: new Map() };
  }

  const procs = new Map();
  const children = new Map();
  for (const line of out.split('\n')) {
    // pid ppid stat etimes args … args だけ空白を含むので最後にまとめて取る
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    const args = m[5];
    procs.set(pid, { pid, ppid, stat: m[3], etimes: Number(m[4]), args, name: commandName(args) });
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  return { procs, children };
}

// ---------------------------------------------------------------------------
// LISTEN しているポート
// ---------------------------------------------------------------------------

let ssBrokenUntil = 0;

/** pid → 待ち受けている TCP ポート。`ss` が無い環境では空で返す */
async function readListeners() {
  if (Date.now() < ssBrokenUntil) return new Map();
  let out;
  try {
    const r = await execFileAsync('ss', ['-lntpH'], { maxBuffer: 4 * 1024 * 1024 });
    out = r.stdout;
  } catch {
    ssBrokenUntil = Date.now() + 60_000; // 無い／使えない環境で毎回叩かない
    return new Map();
  }

  const byPid = new Map();
  for (const line of out.split('\n')) {
    if (!line.includes('users:')) continue;
    const cols = line.trim().split(/\s+/);
    // State Recv-Q Send-Q Local:Port Peer:Port users:((...))
    const local = cols[3] || '';
    const port = Number(local.slice(local.lastIndexOf(':') + 1));
    // エフェメラルポート帯は、エージェントや言語ランタイムが内部通信のために
    // 勝手に開けるものがほとんど。「サーバを立てた」とは呼べないので数えない
    if (!port || port >= 32768) continue;
    for (const m of line.matchAll(/pid=(\d+)/g)) {
      const pid = Number(m[1]);
      if (!byPid.has(pid)) byPid.set(pid, new Set());
      byPid.get(pid).add(port);
    }
  }
  return byPid;
}

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

/** 自分を含む子孫。暴走したプロセス木で固まらないよう上限を付ける */
function descendants(rootPid, procs, children) {
  const out = [];
  const stack = [rootPid];
  const seen = new Set();
  while (stack.length && out.length < 400) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const p = procs.get(pid);
    if (p) out.push(p);
    for (const c of children.get(pid) ?? []) stack.push(c);
  }
  return out;
}

const NOW = () => Date.now();

/**
 * ペイン 1 つぶんの状態。
 *
 *   agent  … Claude Code などのエージェントが生きている
 *   server … 子孫の誰かが TCP を待ち受けている
 *   run    … シェル以外の何かが動いている
 *   idle   … シェルしかいない＝もう使われていない
 */
function classify(rootPid, procs, children, listeners) {
  const tree = descendants(rootPid, procs, children);
  if (tree.length === 0) return { kind: 'idle', agent: null, command: '', ports: [], since: null };

  const ports = new Set();
  for (const p of tree) for (const port of listeners.get(p.pid) ?? []) ports.add(port);

  const work = tree.filter((p) => !SHELLS.has(p.name));
  const agentProc = work.find((p) => AGENTS[p.name]) ?? null;
  // 前景プロセスグループ（stat の `+`）にいるものを優先する。裏で動いている
  // 一時的な子プロセスより、ユーザーが向き合っている相手のほうが知りたい
  const lead = agentProc ?? work.find((p) => p.stat.includes('+')) ?? work[0] ?? null;

  // シェルスクリプトを流している最中はシェルしかいないが、空きではない
  const nestedShell = !lead && tree.some((p) => p.pid !== rootPid);

  const kind = agentProc ? 'agent' : ports.size ? 'server' : lead || nestedShell ? 'run' : 'idle';
  const ref = lead ?? (nestedShell ? tree.find((p) => p.pid !== rootPid) : null);

  return {
    kind,
    agent: agentProc ? AGENTS[agentProc.name] : null,
    command: ref?.name ?? '',
    ports: [...ports].sort((a, b) => a - b),
    // 経過秒をそのまま返すと毎秒値が変わって差分検出が効かない。開始時刻を
    // 5 秒に丸めて返し、経過時間の計算は画面側でやる
    since: ref ? Math.round((NOW() / 1000 - ref.etimes) / 5) * 5 * 1000 : null,
  };
}

// ---------------------------------------------------------------------------
// プロジェクト（＝作業ディレクトリの属するリポジトリ）
// ---------------------------------------------------------------------------

/** リポジトリの目印。`.git` を最優先で探し、無ければこの並び順で近いものを使う */
const MARKERS = ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'CMakeLists.txt'];

const projectCache = new Map(); // cwd -> { root, name, expires }
const PROJECT_TTL = 5 * 60_000; // 途中で git init されても拾えるように

export function findProject(cwd) {
  if (!cwd) return null;
  const hit = projectCache.get(cwd);
  if (hit && hit.expires > NOW()) return hit.value;

  let dir = cwd;
  let git = null;
  let marker = null;
  for (let i = 0; i < 40 && dir && dir !== '/'; i++) {
    try {
      if (!git && fs.existsSync(path.join(dir, '.git'))) git = dir;
      if (!marker && MARKERS.some((f) => fs.existsSync(path.join(dir, f)))) marker = dir;
    } catch {
      /* 読めないディレクトリは飛ばす */
    }
    if (git) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const root = git ?? marker ?? cwd;
  const value = { root, name: path.basename(root) || root };
  projectCache.set(cwd, { value, expires: NOW() + PROJECT_TTL });
  return value;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

let cache = { at: 0, map: new Map() };

/**
 * ペイン一覧に `proc` と `project` を足して返す。
 * ポーリングと REST が同時に来ても `ps` を二重に叩かないよう、少しだけ結果を持つ。
 */
export async function inspectPanes(panes) {
  const pids = [...new Set(panes.map((p) => p.pid).filter(Boolean))];
  if (pids.length === 0) return panes;

  // 期限切れか、まだ見たことのない pid が混ざっていたら取り直す
  if (NOW() - cache.at > 900 || pids.some((pid) => !cache.map.has(pid))) {
    const [{ procs, children }, listeners] = await Promise.all([readProcesses(), readListeners()]);
    const map = new Map();
    for (const pid of pids) map.set(pid, classify(pid, procs, children, listeners));
    cache = { at: NOW(), map };
  }

  return panes.map((p) => ({
    ...p,
    proc: cache.map.get(p.pid) ?? null,
    project: findProject(p.path),
  }));
}
