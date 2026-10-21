import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { HOME, tilde } from './safety.js';
import { run, tmux } from './sh.js';
import { listKnownProjects } from './transcripts.js';
import { rcUrls } from './state.js';
const SESSIONS_DIR = path.join(HOME, '.claude', 'sessions');
// ペイン末尾から読み取る補助情報。状態の主情報は ~/.claude/sessions/<pid>.json から取る。
const RE_APPROVAL = /Do you want to |Do you still want to |❯\s*\d\.\s|Enter to confirm/;
const RE_TRUST = /Quick safety check|Yes, I trust this folder|Accessing workspace:/i;
const RE_RC_URL = /https:\/\/claude\.ai\/code\/[A-Za-z0-9_\-./?=&%]+/;
/** /proc/<pid>/stat の 22 番目（starttime）。pid 再利用で別プロセスを掴まないための照合用。 */
async function procStart(pid) {
    try {
        const raw = await readFile(`/proc/${pid}/stat`, 'utf8');
        const after = raw.slice(raw.lastIndexOf(')') + 2);
        return after.split(' ')[19] ?? null;
    }
    catch {
        return null;
    }
}
async function readSessionFiles() {
    let names;
    try {
        names = await readdir(SESSIONS_DIR);
    }
    catch {
        return [];
    }
    const out = [];
    await Promise.all(names
        .filter((n) => n.endsWith('.json'))
        .map(async (n) => {
        try {
            const s = JSON.parse(await readFile(path.join(SESSIONS_DIR, n), 'utf8'));
            if (!s?.pid || !s.sessionId)
                return;
            if (s.kind && s.kind !== 'interactive')
                return;
            const start = await procStart(s.pid);
            if (!start)
                return; // プロセスが消えている
            if (s.procStart && s.procStart !== start)
                return; // pid が使い回された
            out.push(s);
        }
        catch {
            /* 壊れたファイルは無視 */
        }
    }));
    return out;
}
/** pid → 親 pid の表。ペインからプロセスを辿るのに使う。 */
async function parentMap() {
    const { stdout } = await run('ps', ['-eo', 'pid=,ppid=']);
    const m = new Map();
    for (const line of stdout.split('\n')) {
        const t = /^\s*(\d+)\s+(\d+)/.exec(line);
        if (t)
            m.set(Number(t[1]), Number(t[2]));
    }
    return m;
}
async function listPanes() {
    const fmt = ['#{pane_id}', '#{session_name}', '#{session_group}', '#{window_index}.#{pane_index}', '#{pane_pid}'].join('\t');
    const { stdout, code } = await tmux(['list-panes', '-a', '-F', fmt]);
    if (code !== 0)
        return [];
    // グループ化されたセッション（cw-* など）は同じペインを共有するので pane_id で一意化する。
    // 表示名にはグループ名（元のセッション）を優先する。
    const byId = new Map();
    for (const line of stdout.split('\n')) {
        const p = line.split('\t');
        if (p.length < 5)
            continue;
        const info = { id: p[0], session: p[2] || p[1], window: p[3], pid: Number(p[4]) };
        const prev = byId.get(info.id);
        if (!prev || (p[2] && p[1] === p[2]))
            byId.set(info.id, info);
    }
    return [...byId.values()];
}
/** claude の pid から祖先を辿り、それが属する tmux ペインを見つける。 */
function paneForPid(pid, parents, paneByPid) {
    let cur = pid;
    for (let i = 0; cur && cur > 1 && i < 40; i++) {
        const pane = paneByPid.get(cur);
        if (pane)
            return pane;
        cur = parents.get(cur);
    }
    return null;
}
function mapStatus(raw, paneText) {
    if (RE_TRUST.test(paneText))
        return 'trust_prompt';
    if (RE_APPROVAL.test(paneText.split('\n').slice(-14).join('\n')))
        return 'waiting_approval';
    if (raw === 'busy' || raw === 'shell' || raw === 'running')
        return 'working';
    if (raw === 'idle')
        return 'waiting_input';
    return 'unknown';
}
let cache = null;
export async function discover(force = false) {
    if (!force && cache && Date.now() - cache.at < 1500)
        return cache.value;
    const [sessions, panes, parents] = await Promise.all([readSessionFiles(), listPanes(), parentMap()]);
    const paneByPid = new Map(panes.map((p) => [p.pid, p]));
    const live = await Promise.all(sessions.map(async (s) => {
        const pane = paneForPid(s.pid, parents, paneByPid);
        let paneText = '';
        if (pane) {
            const cap = await tmux(['capture-pane', '-p', '-t', pane.id, '-S', '-40']);
            if (cap.code === 0)
                paneText = cap.stdout;
        }
        const url = RE_RC_URL.exec(paneText);
        if (url && pane)
            rcUrls.set(pane.id, url[0]);
        const rcUrl = (pane ? rcUrls.get(pane.id) : null) ?? null;
        const tail = paneText
            .split('\n')
            // ターミナル用の記号（⏵ ⎿ ⧉ など）はブラウザのフォントに無く豆腐になるので落とす
            .map((l) => l.replace(/[⎀-⏺⧉]/g, '').replace(/\s{2,}/g, ' ').trim())
            .filter((l) => l && !/^[─━|┌┐└┘│]+$/.test(l) && !/^❯\s*$/.test(l))
            .slice(-1)[0] ?? '';
        return {
            id: pane?.id ?? `pid:${s.pid}`,
            paneId: pane?.id ?? null,
            pid: s.pid,
            sessionId: s.sessionId,
            name: s.name || path.basename(s.cwd),
            cwd: s.cwd,
            display: tilde(s.cwd),
            status: mapStatus(s.status, paneText),
            rawStatus: s.status ?? 'unknown',
            rc: !!s.bridgeSessionId,
            rcUrl,
            lastActivity: s.statusUpdatedAt ?? s.updatedAt ?? s.startedAt,
            startedAt: s.startedAt,
            tmuxSession: pane?.session ?? null,
            window: pane?.window ?? null,
            controllable: !!pane,
            tail: tail.slice(0, 160),
        };
    }));
    live.sort((a, b) => b.lastActivity - a.lastActivity);
    // 稼働していないが履歴が残っているプロジェクト = 再開候補
    const liveCwds = new Set(live.map((s) => s.cwd));
    const known = await listKnownProjects(60);
    const stopped = known
        .filter((k) => !liveCwds.has(k.cwd) && existsSync(k.cwd))
        .slice(0, 25)
        .map((k) => ({
        cwd: k.cwd,
        name: path.basename(k.cwd) || k.cwd,
        display: tilde(k.cwd),
        lastActivity: k.mtimeMs,
        sessionId: k.sessionId,
    }));
    const value = { live, stopped };
    cache = { at: Date.now(), value };
    return value;
}
/** キー送信の宛先を検証する。tmux 配下にないセッションは操作させない。 */
export async function requireControllable(id) {
    const { live } = await discover(true);
    const row = live.find((s) => s.id === id || s.paneId === id);
    if (!row)
        throw Object.assign(new Error('そのセッションは見つかりません'), { status: 404 });
    if (!row.paneId) {
        throw Object.assign(new Error('tmux の外で動いているセッションはここから操作できません'), { status: 400 });
    }
    return row;
}
