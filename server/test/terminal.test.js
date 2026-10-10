import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pty from '@homebridge/node-pty-prebuilt-multiarch';

const installer = new URL('../../scripts/install-terminal-tmux.sh', import.meta.url).pathname;
const waitFor = async (check) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('terminal did not reach the expected state');
};

test('terminal setup preserves settings and starts independent, visible tmux sessions', { timeout: 20000 }, async (t) => {
  try { execFileSync('tmux', ['-V']); } catch { t.skip('tmux unavailable'); return; }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-terminal-'));
  const home = path.join(temp, 'home with spaces');
  const cwd = path.join(temp, 'project with spaces');
  const socket = path.join(temp, 'socket');
  await fs.mkdir(home); await fs.mkdir(cwd);
  const env = {
    ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'),
    ZDOTDIR: home, TMUX: '', TMUX_PANE: '', TERM: 'xterm-256color', SHELL: '/bin/bash',
    TMUX_WEB_AUTO_START: '1', TMUX_WEB_TMUX_BIN: 'tmux',
    TMUX_WEB_SOCKET_PATH: socket, TMUX_WEB_SOCKET_NAME: '',
  };
  const clients = [];
  const run = args => execFileSync('tmux', ['-S', socket, ...args], { env, encoding: 'utf8' }).trim();
  t.after(async () => {
    for (const client of clients) { try { client.kill(); } catch {} }
    try { run(['kill-server']); } catch {}
    await fs.rm(temp, { recursive: true, force: true });
  });
  const oldRc = '# user settings\nexport USER_SETTING=preserved\n';
  await fs.writeFile(path.join(home, '.bashrc'), oldRc);
  await fs.writeFile(path.join(home, '.bash_profile'), '# custom login settings\n');
  execFileSync('bash', [installer], { env });
  const installed = await fs.readFile(path.join(home, '.bashrc'), 'utf8');
  assert.ok(installed.startsWith(oldRc));
  assert.match(await fs.readFile(path.join(home, '.bash_profile'), 'utf8'), /terminal auto-start/);
  const backup = (await fs.readdir(home)).find(name => name.startsWith('.bashrc.tmux-web-backup-'));
  assert.equal(await fs.readFile(path.join(home, backup), 'utf8'), oldRc);
  execFileSync('bash', [installer], { env });
  assert.equal(await fs.readFile(path.join(home, '.bashrc'), 'utf8'), installed);

  // 専用サーバを先に起動して、利用者の保存・復元設定を読み込まない。
  run(['-f', '/dev/null', 'new-session', '-d', '-s', 'seed']);
  run(['set-option', '-g', 'default-shell', '/bin/bash']);
  run(['set-option', '-g', 'default-command', 'exec /bin/bash --noprofile --rcfile "$HOME/.bashrc" -i']);
  const sessions = () => run(['list-sessions', '-F', '#{session_id}']).split('\n');
  const spawn = (extraEnv = {}, args = ['--noprofile', '--rcfile', path.join(home, '.bashrc'), '-i']) => {
    const client = pty.spawn('/bin/bash', args, { env: { ...env, ...extraEnv }, cwd, cols: 80, rows: 24 });
    client.onData(() => {});
    clients.push(client);
    return client;
  };
  const first = spawn();
  await waitFor(() => sessions().length === 2);
  const second = spawn();
  await waitFor(() => sessions().length === 3);
  const panes = run(['list-panes', '-a', '-F', '#{session_id}\t#{pane_current_path}']);
  assert.equal(panes.split('\n').filter(line => line.endsWith(`\t${cwd}`)).length, 2);

  // tmux-web と同じ読み取り API が新しい端末を取得できる。
  const oldSocket = process.env.TMUX_WEB_SOCKET_PATH;
  const oldName = process.env.TMUX_WEB_SOCKET_NAME;
  process.env.TMUX_WEB_SOCKET_PATH = socket;
  delete process.env.TMUX_WEB_SOCKET_NAME;
  try {
    const { listSessions, listPanes } = await import('../src/tmux.js');
    assert.equal((await listSessions()).length, 3);
    assert.equal((await listPanes()).filter(pane => pane.path === cwd).length, 2);
  } finally {
    if (oldSocket === undefined) delete process.env.TMUX_WEB_SOCKET_PATH;
    else process.env.TMUX_WEB_SOCKET_PATH = oldSocket;
    if (oldName === undefined) delete process.env.TMUX_WEB_SOCKET_NAME;
    else process.env.TMUX_WEB_SOCKET_NAME = oldName;
  }
  // 内側の .bashrc が再び tmux を起動せず、コマンドを実行できることも確認する。
  for (const [i, client] of [first, second].entries()) {
    const report = path.join(temp, `report-${i}`);
    client.write(`printf '%s\\n' "$TMUX" "$PWD" "$USER_SETTING" > '${report}'\r`);
    await waitFor(async () => { try { return (await fs.readFile(report, 'utf8')).includes('preserved'); } catch { return false; } });
    const lines = (await fs.readFile(report, 'utf8')).trim().split('\n');
    assert.ok(lines[0].startsWith(socket));
    assert.equal(lines[1], cwd);
    assert.equal(lines[2], 'preserved');
  }
  assert.equal(sessions().length, 3);

  // tmux から起動した GUI 端末は TMUX を継承しても別 tty なので新規接続する。
  const inheritedPane = run(['list-panes', '-t', 'seed', '-F', '#{pane_id}']);
  const inheritedServer = run(['display-message', '-p', '-t', inheritedPane, '#{pid}']);
  spawn({ TMUX: `${socket},${inheritedServer},0`, TMUX_PANE: inheritedPane });
  await waitFor(() => sessions().length === 4);

  // 非対話処理、明示コマンド、tmux 内、無効化、接続失敗は素のシェルを残す。
  const plain = execFileSync('/bin/bash', ['-c', '. "$HOME/.bashrc"; printf plain'], { env, encoding: 'utf8' });
  assert.equal(plain, 'plain');
  const commandReport = path.join(temp, 'command-report');
  spawn({}, ['--noprofile', '--rcfile', path.join(home, '.bashrc'), '-ic', `printf command > '${commandReport}'`]);
  await waitFor(async () => { try { return (await fs.readFile(commandReport, 'utf8')) === 'command'; } catch { return false; } });
  for (const [i, extra] of [{ TMUX_WEB_AUTO_START: '0' }, { TMUX_WEB_TMUX_BIN: '/bin/false' }].entries()) {
    const client = spawn(extra);
    const report = path.join(temp, `plain-${i}`);
    client.write(`printf plain > '${report}'\r`);
    await waitFor(async () => { try { return (await fs.readFile(report, 'utf8')) === 'plain'; } catch { return false; } });
  }
  assert.equal(sessions().length, 4);
});
