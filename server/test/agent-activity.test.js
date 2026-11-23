import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { installAgentActivity } from '../src/agent-activity.js';
import { auth, headers, fetch } from './helpers/tailscale.js';

test('returns confined and authenticated turn metadata for the requested period', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'tmux-activity-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const now = Date.now();
  const timestamp = offset => new Date(now + offset).toISOString();
  const claude = (type, offset, cwd, content, extra) => ({
    type, timestamp: timestamp(offset), cwd, message: { content }, ...extra,
  });
  const prompt = (offset, cwd) => claude('user', offset, cwd, 'private');
  const reply = (offset, cwd, extra) => claude('assistant', offset, cwd, [{ type: 'text', text: 'private' }], extra);
  const finish = (offset, cwd) => claude('system', offset, cwd, undefined, { subtype: 'turn_duration', durationMs: 800000 });
  const responseItem = (offset, type, extra) => ({
    type: 'response_item', timestamp: timestamp(offset), payload: { type, ...extra },
  });
  const event = (type, turn_id, offset) => ({ type: 'event_msg', timestamp: timestamp(offset), payload: { type, turn_id } });
  const meta = { type: 'session_meta', payload: { cwd: '/work/tmux-web', source: 'cli' } };
  async function add(file, rows) {
    const dest = path.join(home, file);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, rows.map(row => JSON.stringify(row)).join('\n') + '\n{');
    return dest;
  }

  const folder = '/work/folder-a';
  await add('.claude/projects/project/session.jsonl', [
    prompt(-700000, '/work/outside-range'),
    reply(-680000, '/work/outside-range'),
    finish(-670000, '/work/outside-range'),
    prompt(-450000, folder),
    reply(-410000, folder),
    claude('assistant', -400000, folder, [{ type: 'tool_use', name: 'AskUserQuestion', id: 'question' }]),
    claude('user', -190000, folder, [{ type: 'tool_result', tool_use_id: 'question' }]),
    reply(-160000, folder),
    reply(-150000, '/work/subagent', { isSidechain: true }),
    finish(-140000, folder),
    prompt(-130000, '/work/finished-without-progress'),
    finish(-129000, '/work/finished-without-progress'),
  ]);
  const privateFile = await add('private.jsonl', [prompt(-100000, '/work/secret-folder'), reply(-1000, '/work/secret-folder')]);
  await symlink(privateFile, path.join(home, '.claude/projects/project/link.jsonl'));
  await add('.codex/sessions/2026/11/23/rollout.jsonl', [
    meta,
    event('task_started', 'a', -600000),
    responseItem(-590000, 'reasoning'),
    event('token_count', 'a', -300000),
    responseItem(-230000, 'function_call', { name: 'sleep', call_id: 'sleep-1' }),
    responseItem(-130000, 'function_call_output', { call_id: 'sleep-1' }),
    responseItem(-120000, 'custom_tool_call', { name: 'exec', call_id: 'exec-1' }),
    responseItem(-110000, 'custom_tool_call_output', { call_id: 'exec-1' }),
    event('task_complete', 'a', -100000),
    event('task_started', 'b', -90000),
    responseItem(-85000, 'reasoning'),
    responseItem(-80000, 'reasoning'),
    event('task_started', 'empty', -79000),
    event('task_complete', 'empty', -78500),
  ]);
  await add('.codex/archived_sessions/old-rollout.jsonl', [
    meta,
    event('task_started', 'c', -78000),
    responseItem(-76000, 'reasoning'),
    event('turn_aborted', 'c', -75000),
  ]);

  const app = express();
  app.use('/api', auth().middleware);
  installAgentActivity(app, { home, claudeHome: path.join(home, '.claude'), codexHome: path.join(home, '.codex') });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/agents/activity`;
  const range = `${url}?from=${now - 620000}&to=${now}`;
  assert.equal((await fetch(range)).status, 401);
  assert.equal((await fetch(url + '?from=0&to=9999999999999', { headers })).status, 400);
  const response = await fetch(range, { headers });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { metric: 'progress-v1', turns: [
    { agent: 'codex', project: 'tmux-web', start: now - 600000, end: now - 590000 },
    { agent: 'claude', project: 'folder-a', start: now - 450000, end: now - 400000 },
    { agent: 'claude', project: 'folder-a', start: now - 190000, end: now - 140000 },
    { agent: 'codex', project: 'tmux-web', start: now - 130000, end: now - 100000 },
    { agent: 'codex', project: 'tmux-web', start: now - 90000, end: now - 80000 },
    { agent: 'codex', project: 'tmux-web', start: now - 78000, end: now - 75000 },
  ] });
});
