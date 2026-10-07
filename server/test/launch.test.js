import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// 利用者の tmux と CLI に触らず、専用ソケットと偽 CLI で起動経路を確認する。
test('launches each agent in a new window at the requested cwd and preserves the shell', async (t) => {
  try { execFileSync('tmux', ['-V']); } catch { t.skip('tmux unavailable'); return; }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-launch-'));
  const socket = path.join(temp, 'socket');
  const cwd = path.join(temp, 'project with spaces');
  const bin = path.join(temp, 'bin');
  await fs.mkdir(cwd); await fs.mkdir(bin);
  for (const agent of ['claude', 'codex']) {
    await fs.writeFile(path.join(bin, agent), `#!/bin/sh\npwd > "${temp}/${agent}.cwd"\nprintf '${agent} started\\n'\n`, { mode: 0o755 });
  }
  const env = { ...process.env, TMUX: '', PATH: `${bin}:${process.env.PATH}` };
  const run = (args) => execFileSync('tmux', ['-S', socket, ...args], { env, encoding: 'utf8' }).trim();
  const oldPath = process.env.PATH;
  process.env.PATH = env.PATH;
  const oldSocket = process.env.TMUX_WEB_SOCKET_PATH;
  process.env.TMUX_WEB_SOCKET_PATH = socket;
  t.after(async () => {
    try { run(['kill-server']); } catch {}
    process.env.PATH = oldPath;
    if (oldSocket === undefined) delete process.env.TMUX_WEB_SOCKET_PATH;
    else process.env.TMUX_WEB_SOCKET_PATH = oldSocket;
    await fs.rm(temp, { recursive: true, force: true });
  });
  run(['-f', '/dev/null', 'new-session', '-d', '-s', 'qa', '-c', cwd]);
  run(['set-option', '-g', 'default-shell', '/bin/sh']);
  run(['set-environment', '-g', 'PATH', env.PATH]);
  const { actions } = await import('../src/tmux.js');
  assert.throws(() => actions.launchAgent({ target: 'qa', agent: 'claude; false' }), /Claude/);
  for (const agent of ['claude', 'codex']) {
    const id = (await actions.launchAgent({ target: 'qa', cwd, agent })).trim();
    assert.match(id, /^@\d+$/);
    for (let i = 0; i < 40; i++) {
      try { if ((await fs.readFile(path.join(temp, `${agent}.cwd`), 'utf8')).trim() === cwd) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const output = run(['capture-pane', '-p', '-t', id]);
    assert.match(output, new RegExp(`${agent} started`));
    assert.equal((await fs.readFile(path.join(temp, `${agent}.cwd`), 'utf8')).trim(), cwd);
    assert.match(run(['capture-pane', '-p', '-t', id]), new RegExp(`${agent} started`));
    assert.equal(run(['display-message', '-p', '-t', id, '#{pane_dead}']), '0');
  }
  assert.equal(run(['list-windows', '-t', 'qa', '-F', '#{window_id}']).split('\n').length, 3);
});
