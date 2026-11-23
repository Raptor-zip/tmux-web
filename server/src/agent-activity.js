import { constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const DAY = 86_400_000;
const MAX_PROGRESS_GAP = 5 * 60_000;
const METRIC = 'progress-v1';
const responseEvents = new Set([
  'reasoning', 'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output',
  'web_search_call', 'local_shell_call', 'agent_message',
]);
const codexProgressEvents = new Set(['exec_command_end', 'patch_apply_end', 'web_search_end', 'agent_reasoning']);
const waitingTools = new Set(['sleep', 'request_user_input']);
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

// Keep intervals confirmed by consecutive progress records, including in unfinished turns.
function turnState(project, timestamp) {
  return { project, previous: timestamp, block: undefined, progressed: false, waitingFor: undefined };
}

function advance(turns, agent, state, timestamp) {
  if (state.waitingFor || timestamp <= state.previous) return;
  if (timestamp - state.previous <= MAX_PROGRESS_GAP) {
    if (state.block?.end === state.previous) state.block.end = timestamp;
    else {
      state.block = { agent, project: state.project, start: state.previous, end: timestamp };
      turns.push(state.block);
    }
  }
  state.previous = timestamp;
}

function resume(state, timestamp) {
  state.waitingFor = undefined;
  state.previous = Math.max(state.previous, timestamp);
}

function readClaude(turns, state, row, timestamp) {
  if (row.isSidechain || row.isMeta) return state;
  if (row.type === 'user' || row.type === 'assistant') {
    const content = row.message?.content;
    const tools = Array.isArray(content) ? content : [];
    if (row.type === 'user') {
      const results = tools.filter(item => item?.type === 'tool_result');
      if (!results.length) return turnState(projectName(row.cwd), timestamp);
      if (results.some(item => item.tool_use_id && item.tool_use_id === state?.waitingFor)) resume(state, timestamp);
      else if (state?.progressed) advance(turns, 'claude', state, timestamp);
      return state;
    }
    if (row.message?.model === '<synthetic>' || !tools.some(item =>
      ['thinking', 'redacted_thinking', 'text', 'tool_use', 'server_tool_use'].includes(item?.type))) return state;
    state ??= turnState(projectName(row.cwd), timestamp);
    advance(turns, 'claude', state, timestamp);
    state.progressed = true;
    state.waitingFor ||= tools.find(item => item?.type === 'tool_use' && item.name === 'AskUserQuestion')?.id;
  }
  if (row.type === 'system' && row.subtype === 'turn_duration') {
    if (state?.progressed) advance(turns, 'claude', state, timestamp);
    return undefined;
  }
  return state;
}

async function readTurns(handle, agent, size) {
  const turns = [];
  if (size === 0) return turns;
  const started = new Map();
  let activeId;
  let claude;
  let project = 'プロジェクト不明';
  const input = handle.createReadStream({ end: size - 1, autoClose: false });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    // Skip large transcript records that do not carry timed activity.
    if (!/"type"\s*:\s*"(?:assistant|user|system|session_meta|turn_context|event_msg|response_item)"/.test(line)) continue;
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
    if (agent === 'claude') {
      claude = readClaude(turns, claude, row, timestamp);
      continue;
    }

    const event = row.payload;
    if (!event || typeof event !== 'object') continue;
    const id = event.turn_id ?? activeId;
    const state = started.get(id);
    if (row.type === 'turn_context' && state && typeof event.cwd === 'string') {
      state.project = projectName(event.cwd);
    }
    if (row.type === 'event_msg' && event.type === 'task_started' && typeof event.turn_id === 'string') {
      activeId = id;
      started.set(id, turnState(project, timestamp));
      continue;
    }
    if (!state) continue;
    if (row.type === 'event_msg' && (event.type === 'turn_aborted' || event.type === 'task_complete')) {
      if (state.progressed) advance(turns, agent, state, timestamp);
      started.delete(id);
      if (activeId === id) activeId = undefined;
      continue;
    }

    if (row.type === 'response_item') {
      if (!(responseEvents.has(event.type) || (event.type === 'message' && event.role === 'assistant'))) continue;
      if (state.waitingFor && event.type.endsWith('_output') && event.call_id === state.waitingFor) {
        resume(state, timestamp);
        continue;
      }
    } else if (row.type !== 'event_msg' || !codexProgressEvents.has(event.type)) continue;
    advance(turns, agent, state, timestamp);
    state.progressed = true;
    if (row.type === 'response_item' && event.type === 'function_call' && waitingTools.has(event.name)) {
      state.waitingFor ||= event.call_id;
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
      if (recent?.key === key && recent.expires > Date.now()) return res.json({ metric: METRIC, turns: recent.turns });
      scan ??= { key, result: collect(from, to).finally(() => { scan = undefined; }) };
      const turns = await scan.result;
      recent = { key, turns, expires: Date.now() + 15_000 };
      res.json({ metric: METRIC, turns });
    } catch {
      res.status(500).json({ error: '稼働ログを読み込めませんでした。' });
    }
  });
}
