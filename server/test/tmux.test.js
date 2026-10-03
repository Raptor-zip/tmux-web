import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { snapshot } from '../src/tmux.js';

test('tmux session, window and pane formats preserve IDs and working directories', {
  skip: spawnSync('tmux', ['-V']).status !== 0,
}, async () => {
  const socket = `tmux-web-test-${process.pid}`;
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'tmux-web-test-'));
  const oldSocket = process.env.TMUX_WEB_SOCKET_NAME;
  const oldPath = process.env.TMUX_WEB_SOCKET_PATH;
  process.env.TMUX_WEB_SOCKET_NAME = socket;
  delete process.env.TMUX_WEB_SOCKET_PATH;
  try {
    execFileSync('tmux', ['-L', socket, '-f', '/dev/null', 'new-session', '-d', '-s', 'format-test', '-c', cwd], {
      env: { ...process.env, TMUX: '' },
    });
    const state = await snapshot();
    assert.equal(state.sessions.length, 1);
    assert.equal(state.sessions[0].name, 'format-test');
    assert.match(state.sessions[0].id, /^\$\d+$/);
    assert.ok(state.serverPid > 0);
    assert.equal(state.windows.length, 1);
    assert.match(state.windows[0].id, /^@\d+$/);
    assert.equal(state.windows[0].sessionId, state.sessions[0].id);
    assert.equal(state.panes.length, 1);
    assert.match(state.panes[0].id, /^%\d+$/);
    assert.equal(state.panes[0].windowId, state.windows[0].id);
    assert.equal(state.panes[0].path, cwd);
  } finally {
    spawnSync('tmux', ['-L', socket, 'kill-server']);
    if (oldSocket === undefined) delete process.env.TMUX_WEB_SOCKET_NAME;
    else process.env.TMUX_WEB_SOCKET_NAME = oldSocket;
    if (oldPath === undefined) delete process.env.TMUX_WEB_SOCKET_PATH;
    else process.env.TMUX_WEB_SOCKET_PATH = oldPath;
    rmSync(cwd, { recursive: true, force: true });
  }
});
