import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmux, capturePane } from './tmux.js';

const exec = promisify(execFile);
const fail = (status, message) => Object.assign(new Error(message), { status });
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const within = (root, dir) => dir === root || dir.startsWith(root + path.sep);

export function createWorkspaces({ home = os.homedir(), runTmux = tmux, run = exec } = {}) {
  let historyCache;
  async function directory(value) {
    if (typeof value !== 'string' || value.includes('\0')) throw fail(400, 'フォルダーを指定してください');
    const expanded = value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
    const dir = await fs.realpath(path.resolve(home, expanded));
    if (!within(home, dir) || path.relative(home, dir).split(path.sep).some(p => p.startsWith('.'))) throw fail(403, 'ホーム配下の作業フォルダーを指定してください');
    if (!(await fs.stat(dir)).isDirectory()) throw fail(400, 'フォルダーを指定してください');
    return dir;
  }
  /**
   * Codex の会話。~/.codex/sessions/年/月/日/rollout-<時刻>-<id>.jsonl の新しいものから見る。
   * 先頭行（session_meta）は指示文を含んで長いので、JSON として読まず先頭の一部から cwd と source を拾う。
   * codex exec の自動実行（source が exec）は、人が続ける会話ではないので出さない。
   */
  async function codexRecent() {
    const base = path.join(home, '.codex', 'sessions');
    const names = async dir => (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).map(d => d.name).sort().reverse();
    const files = [];
    outer: for (const year of await names(base)) {
      if (!/^\d{4}$/.test(year)) continue;
      for (const month of await names(path.join(base, year))) {
        for (const day of await names(path.join(base, year, month))) {
          const dir = path.join(base, year, month, day);
          for (const name of await names(dir)) {
            if (!name.endsWith('.jsonl')) continue;
            files.push(path.join(dir, name));
            if (files.length >= 200) break outer;
          }
        }
      }
    }
    const items = [];
    for (const file of files) {
      const id = path.basename(file).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i)?.[1];
      if (!id) continue;
      const handle = await fs.open(file, 'r').catch(() => null);
      if (!handle) continue;
      try {
        const stat = await handle.stat();
        const buf = Buffer.alloc(16384);
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
        const head = buf.subarray(0, bytesRead).toString();
        if (/"source":"exec"/.test(head)) continue;
        const raw = head.match(/"cwd":("(?:[^"\\]|\\.)*")/)?.[1];
        if (!raw) continue;
        let cwd;
        try { cwd = JSON.parse(raw); } catch { continue; }
        cwd = await directory(cwd).catch(() => null);
        if (!cwd) continue;
        items.push({ agent: 'codex', cwd, name: path.basename(cwd), sessionId: id, modified: stat.mtimeMs, summary: '' });
      } finally { await handle.close(); }
    }
    return items;
  }
  async function recent() {
    if (historyCache && Date.now() - historyCache.at < 15000) return historyCache.items;
    const base = path.join(home, '.claude', 'projects');
    const dirs = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
    const projects = [];
    for (const entry of dirs.filter(d => d.isDirectory())) {
      const folder = path.join(base, entry.name);
      const files = await fs.readdir(folder).catch(() => []);
      const candidates = await Promise.all(files.filter(n => n.endsWith('.jsonl') && uuid.test(n.slice(0, -6))).map(async name => {
        const stat = await fs.stat(path.join(folder, name)).catch(() => null);
        return stat?.isFile() ? { name, modified: stat.mtimeMs } : null;
      }));
      const latest = candidates.filter(Boolean).sort((a, b) => b.modified - a.modified)[0];
      if (!latest) continue;
      const handle = await fs.open(path.join(folder, latest.name), 'r').catch(() => null);
      if (!handle) continue;
      try {
        const buf = Buffer.alloc(65536);
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
        let cwd;
        let summary = '';
        for (const line of buf.subarray(0, bytesRead).toString().split('\n')) {
          try {
            const row = JSON.parse(line);
            if (typeof row.cwd === 'string') cwd ??= row.cwd;
            if (row.type === 'summary' && typeof row.summary === 'string') summary = row.summary.slice(0, 160);
          } catch { /* incomplete final record */ }
        }
        if (!cwd) continue;
        cwd = await directory(cwd).catch(() => null);
        if (!cwd) continue;
        projects.push({ agent: 'claude', cwd, name: path.basename(cwd), sessionId: latest.name.slice(0, -6), modified: latest.modified, summary });
      } finally { await handle.close(); }
    }
    projects.push(...await codexRecent());
    // 同じフォルダーでも Claude と Codex の会話は別々に残す（どちらで続けるかを選べるように）
    const unique = new Map();
    for (const project of projects.sort((a, b) => b.modified - a.modified)) {
      const key = `${project.agent}:${project.cwd}`;
      if (!unique.has(key)) unique.set(key, project);
    }
    const items = [...unique.values()].slice(0, 80);
    historyCache = { at: Date.now(), items };
    return items;
  }
  async function start(body) {
    const { mode, name, template = 'none', agent = 'claude', prompt = '', resumeId, remoteControl = false } = body;
    if (!['new', 'existing'].includes(mode) || !['none', 'node', 'python'].includes(template) || !['claude', 'codex', 'shell'].includes(agent)) throw fail(400, '作成方法・テンプレート・起動するツールを確認してください');
    if (typeof prompt !== 'string' || prompt.length > 32000) throw fail(400, '指示は32,000文字以内で入力してください');
    if (resumeId && (!['claude', 'codex'].includes(agent) || typeof resumeId !== 'string' || !uuid.test(resumeId))) throw fail(400, '再開する履歴が無効です');
    let cwd;
    if (mode === 'new') {
      if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[/\\\x00-\x1f\x7f]/.test(name) || name.trim().startsWith('.')) throw fail(400, 'プロジェクト名は80文字以内で、スラッシュや先頭のドットを含めずに入力してください');
      const parent = await directory(body.parent || home);
      cwd = path.join(parent, name.trim());
      try { await fs.mkdir(cwd); } catch (error) { if (error.code === 'EEXIST') throw fail(409, '同じ名前のフォルダーがあります。「既存のフォルダー」から開けます'); throw error; }
      await run('git', ['-C', cwd, 'init', '-q', '-b', 'main']);
      await fs.writeFile(path.join(cwd, '.gitignore'), 'node_modules/\n.venv*/\n__pycache__/\n.env\n.env.local\nout/\ndist/\n');
      if (template === 'node') {
        await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'app', private: true, type: 'module', scripts: { start: 'node index.js' } }, null, 2) + '\n');
        await fs.writeFile(path.join(cwd, 'index.js'), 'console.log("Hello")\n');
      } else if (template === 'python') {
        await fs.writeFile(path.join(cwd, 'pyproject.toml'), '[project]\nname = "app"\nversion = "0.1.0"\nrequires-python = ">=3.10"\n');
        await fs.writeFile(path.join(cwd, 'main.py'), 'print("Hello")\n');
      }
    } else cwd = await directory(body.dir);
    const args = [agent];
    if (agent === 'claude') {
      if (resumeId) args.push('--resume', resumeId);
      if (remoteControl) args.push('--remote-control');
    } else if (agent === 'codex' && resumeId) args.push('resume', resumeId);
    if (prompt.trim()) args.push('--', prompt);
    const command = agent === 'shell' ? null : `${agent === 'claude' ? 'CLAUDE_CODE_NO_FLICKER=1 ' : ''}${args.map(quote).join(' ')}; exec "$SHELL" -l`;
    const tmuxArgs = ['new-session', '-d', '-P', '-F', '#{session_id}\t#{window_id}\t#{pane_id}', '-c', cwd, '-x', '140', '-y', '40'];
    if (command) tmuxArgs.push(command);
    let result;
    try { result = await runTmux(tmuxArgs); }
    catch (error) { throw fail(502, mode === 'new' ? 'フォルダーは作成済みです。端末の起動に失敗しました。「既存のフォルダー」から開き直してください' : '端末を起動できませんでした。もう一度お試しください'); }
    const [sessionId, windowId, paneId] = result.trim().split('\t');
    if (!/^\$\d+$/.test(sessionId) || !/^@\d+$/.test(windowId) || !/^%\d+$/.test(paneId)) throw fail(502, '起動した端末を取得できませんでした');
    historyCache = null;
    return { sessionId, windowId, paneId, cwd };
  }
  return { recent, start };
}

export function installWorkspaces(app, getPane, options) {
  const workspaces = createWorkspaces(options);
  const rcRequests = new Map();
  const handle = fn => async (req, res) => { try { res.set('Cache-Control', 'no-store').json(await fn(req)); } catch (error) { res.status(error.status || (error.code === 'ENOENT' ? 404 : 500)).json({ error: error.status ? error.message : error.code === 'ENOENT' ? 'フォルダーが見つかりません' : 'プロジェクトを開けませんでした' }); } };
  app.get('/api/projects/recent', handle(async () => ({ projects: await workspaces.recent() })));
  app.post('/api/projects/start', handle(req => workspaces.start(req.body || {})));
  app.post('/api/claude/remote-control', handle(async req => {
    const pane = await getPane(req.body?.pane);
    if (pane?.proc?.agent?.toLowerCase() !== 'claude') throw fail(409, 'Claude が動いている端末を選んでください');
    const text = await capturePane(pane.id, { lines: 100, escapes: false });
    const url = text.match(/https:\/\/claude\.ai\/code\/[A-Za-z0-9_./?=&%#-]+/)?.[0];
    if (url) return { url };
    if (req.body?.connect === false) return { pending: true };
    if (pane.busy) throw fail(409, 'Claude の作業が終わってから接続してください');
    if (Date.now() - (rcRequests.get(pane.id) || 0) < 30000) return { pending: true };
    for (const [id, at] of rcRequests) if (Date.now() - at > 30000) rcRequests.delete(id);
    rcRequests.set(pane.id, Date.now());
    try {
      await tmux(['send-keys', '-t', pane.id, '-l', '/remote-control']);
      await tmux(['send-keys', '-t', pane.id, 'Enter']);
    } catch (error) { rcRequests.delete(pane.id); throw error; }
    return { pending: true };
  }));
}
