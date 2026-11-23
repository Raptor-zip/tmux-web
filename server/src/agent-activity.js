import { constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const DAY = 86_400_000;
const records = /"(?:turn_duration|session_meta|task_started|task_complete|turn_aborted)"/;
const projectName = cwd => typeof cwd === 'string' && cwd ? path.basename(cwd).slice(0, 160) : 'プロジェクト不明';

async function* logs(directory, depth) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (depth > 0 && entry.isDirectory()) yield* logs(file, depth - 1);
    if (depth === 0 && entry.isFile() && entry.name.endsWith('.jsonl')) yield file;
  }
}

async function readTurns(handle, agent, size) {
  const turns = [];
  const started = new Map();
  let project = 'プロジェクト不明';
  if (size === 0) return turns;
  const input = handle.createReadStream({ end: size - 1, autoClose: false });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!records.test(line)) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== 'object') continue;
    if (agent === 'codex' && row.type === 'session_meta') {
      if (row.payload?.source?.subagent || row.payload?.source?.sub_agent) return [];
      project = projectName(row.payload?.cwd);
      continue;
    }
    const timestamp = Date.parse(row.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    if (agent === 'claude' && !row.isSidechain && row.type === 'system' && row.subtype === 'turn_duration') {
      const duration = row.durationMs;
      if (Number.isFinite(duration) && duration > 0) {
        turns.push({ agent, project: projectName(row.cwd), start: timestamp - duration, end: timestamp });
      }
    }
    if (agent === 'codex' && row.type === 'event_msg') {
      const event = row.payload;
      const id = event?.turn_id;
      if (typeof id !== 'string') continue;
      if (event.type === 'task_started') started.set(id, timestamp);
      if (event.type === 'turn_aborted' || event.type === 'task_complete') {
        const start = started.get(id);
        started.delete(id);
        if (start < timestamp) turns.push({ agent, project, start, end: timestamp });
      }
    }
  }
  return turns;
}

export function installAgentActivity(app, { home = os.homedir(), claudeHome, codexHome } = {}) {
  const sources = [
    ['claude', path.join(claudeHome || process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'projects'), 1],
    ['codex', path.join(codexHome || process.env.CODEX_HOME || path.join(home, '.codex'), 'sessions'), 3],
    ['codex', path.join(codexHome || process.env.CODEX_HOME || path.join(home, '.codex'), 'archived_sessions'), 0],
  ];
  const cache = new Map();
  let scan;
  let recent;
  async function collect(from, to) {
    const result = [];
    for (const [agent, directory, depth] of sources) {
      for await (const file of logs(directory, depth)) {
        const stat = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
        if (!stat?.isFile() || stat.mtimeMs < from) continue;
        const key = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
        let parsed = cache.get(file);
        if (parsed?.key !== key) {
          let handle;
          try {
            handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            const opened = await handle.stat();
            if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) continue;
            parsed = { key, turns: await readTurns(handle, agent, stat.size) };
            cache.delete(file);
            cache.set(file, parsed);
            if (cache.size > 2048) cache.delete(cache.keys().next().value);
          } catch (error) {
            if (error.code === 'ENOENT' || error.code === 'ELOOP') continue;
            throw error;
          } finally { await handle?.close(); }
        }
        for (const turn of parsed.turns) if (turn.end > from && turn.start < to) result.push(turn);
      }
    }
    return result.sort((a, b) => a.start - b.start);
  }

  app.get('/api/agents/activity', async (req, res) => {
    const { from: rawFrom, to: rawTo } = req.query;
    const from = Number(rawFrom), to = Number(rawTo);
    if (typeof rawFrom !== 'string' || typeof rawTo !== 'string' || !Number.isSafeInteger(from)
      || !Number.isSafeInteger(to) || from < 0 || to <= from || to - from > 8 * DAY) {
      return res.status(400).json({ error: '8日以内の表示期間を指定してください。' });
    }
    res.set('Cache-Control', 'no-store');
    const key = `${from}:${to}`;
    try {
      while (scan && scan.key !== key) await scan.result.catch(() => {});
      if (recent?.key === key && recent.expires > Date.now()) return res.json({ turns: recent.turns });
      scan ??= { key, result: collect(from, to).finally(() => { scan = undefined; }) };
      const turns = await scan.result;
      recent = { key, turns, expires: Date.now() + 15_000 };
      res.json({ turns });
    } catch {
      res.status(500).json({ error: '稼働ログを読み込めませんでした。' });
    }
  });
}
