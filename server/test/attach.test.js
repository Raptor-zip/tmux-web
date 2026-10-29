import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import pty from '@homebridge/node-pty-prebuilt-multiarch';
import { createAttachment } from '../src/attach.js';

const native = { timeout: 10000, skip: spawnSync('tmux', ['-V']).status !== 0 };

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-attachment-'));
  const socket = path.join(temp, 'socket');
  const saved = { TMUX_WEB_SOCKET_PATH: process.env.TMUX_WEB_SOCKET_PATH, TMUX_WEB_SOCKET_NAME: process.env.TMUX_WEB_SOCKET_NAME };
  process.env.TMUX_WEB_SOCKET_PATH = socket;
  delete process.env.TMUX_WEB_SOCKET_NAME;
  const attachments = [];
  const attach = async options => {
    const attachment = await createAttachment(options);
    attachments.push(attachment);
    return attachment;
  };
  const run = args => execFileSync('tmux', ['-S', socket, ...args], { env: { ...process.env, TMUX: '' }, encoding: 'utf8' }).trim();
  t.after(async () => {
    for (const attachment of attachments) await attachment.dispose();
    try { run(['kill-server']); } catch {}
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return { temp, run, attach };
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('tmux attachment did not become ready');
}

test('attachments survive removal of the original session directory without changing the running pane', native, async t => {
  const { temp, run, attach } = await fixture(t);
  const original = path.join(temp, 'original');
  const current = path.join(temp, 'current');
  const ready = path.join(temp, 'ready');
  await fs.mkdir(original); await fs.mkdir(current);
  const script = path.join(temp, 'running.cjs');
  await fs.writeFile(script, `process.chdir(process.argv[2]); require('node:fs').writeFileSync(process.argv[3], 'ready'); setInterval(() => {}, 1000);`);
  run(['-f', '/dev/null', 'new-session', '-d', '-s', 'original', '-c', original, process.execPath, script, current, ready]);
  await waitFor(async () => { try { await fs.access(ready); return true; } catch { return false; } });
  assert.equal(run(['display-message', '-p', '-t', 'original', '#{session_path}']), original);
  await fs.rmdir(original);
  const pane = run(['display-message', '-p', '-t', 'original', '#{pane_id}']);
  const pid = run(['display-message', '-p', '-t', 'original', '#{pane_pid}']);
  for (const mode of ['mirror', 'direct']) {
    const attachment = await attach({ sessionId: 'original', mode });
    let exit = null;
    const listener = attachment.pty.onExit(({ exitCode }) => { exit = exitCode; });
    const output = attachment.pty.onData(() => {});
    try {
      await waitFor(() => {
        assert.equal(exit, null, `tmux client exited before attaching in ${mode} mode`);
        return run(['list-clients', '-t', attachment.attachTarget, '-F', '#{client_session}']).length > 0;
      });
      assert.equal(run(['display-message', '-p', '-t', 'original', '#{pane_id}']), pane);
      assert.equal(run(['display-message', '-p', '-t', 'original', '#{pane_pid}']), pid);
      assert.equal(run(['display-message', '-p', '-t', 'original', '#{pane_current_path}']), current);
    } finally {
      listener.dispose(); output.dispose();
      await Promise.all([attachment.dispose(), attachment.dispose()]);
    }
    assert.equal(run(['list-sessions', '-F', '#{session_name}']), 'original');
  }
});

test('a native PTY startup failure removes only the acquired mirror and preserves the original error', native, async t => {
  const { temp, run, attach } = await fixture(t);
  run(['-f', '/dev/null', 'new-session', '-d', '-s', 'original', '-c', temp, 'sleep', '60']);
  const failure = new Error('fixture: native PTY allocation failed');
  t.mock.method(pty, 'spawn', () => { throw failure; });
  for (const mode of ['mirror', 'direct']) {
    await assert.rejects(attach({ sessionId: 'original', mode }), error => error === failure);
    assert.equal(run(['list-sessions', '-F', '#{session_name}']), 'original');
    assert.equal(run(['display-message', '-p', '-t', 'original', '#{pane_dead}']), '0');
  }
});
