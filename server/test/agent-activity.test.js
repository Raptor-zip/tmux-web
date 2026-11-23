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
  const claude = (offset, cwd, isSidechain = false) => ({
    type: 'system', subtype: 'turn_duration', durationMs: 60000,
    timestamp: timestamp(offset), cwd, isSidechain, message: 'private',
  });
  const event = (type, turn_id, offset) => ({ type: 'event_msg', timestamp: timestamp(offset), payload: { type, turn_id } });
  const meta = { type: 'session_meta', payload: { cwd: '/work/tmux-web', source: 'cli' } };
  async function add(file, rows) {
    const dest = path.join(home, file);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, rows.map(row => JSON.stringify(row)).join('\n') + '\n{');
    return dest;
  }

  await add('.claude/projects/project/session.jsonl', [
    claude(-360000, '/work/outside-range'),
    claude(-1000, '/work/folder-a'),
    claude(-1000, '/work/subagent', true),
  ]);
  const privateFile = await add('private.jsonl', [claude(-1000, '/work/secret-folder')]);
  await symlink(privateFile, path.join(home, '.claude/projects/project/link.jsonl'));
  await add('.codex/sessions/2026/11/23/rollout.jsonl', [
    meta,
    event('task_started', 'a', -100000),
    event('task_started', 'b', -90000),
    event('task_complete', 'a', -80000),
  ]);
  await add('.codex/archived_sessions/old-rollout.jsonl', [
    meta,
    event('task_started', 'c', -78000),
    event('turn_aborted', 'c', -75000),
  ]);

  const app = express();
  app.use('/api', auth().middleware);
  installAgentActivity(app, { home, claudeHome: path.join(home, '.claude'), codexHome: path.join(home, '.codex') });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/agents/activity`;
  const range = `${url}?from=${now - 120000}&to=${now}`;
  assert.equal((await fetch(range)).status, 401);
  assert.equal((await fetch(url + '?from=0&to=9999999999999', { headers })).status, 400);
  const response = await fetch(range, { headers });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { turns: [
    { agent: 'codex', project: 'tmux-web', start: now - 100000, end: now - 80000 },
    { agent: 'codex', project: 'tmux-web', start: now - 78000, end: now - 75000 },
    { agent: 'claude', project: 'folder-a', start: now - 61000, end: now - 1000 },
  ] });
});
