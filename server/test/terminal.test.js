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

for (const useXdg of [false, true]) {
  test(`terminal scrolling installs and updates live tmux (${useXdg ? 'XDG' : 'home'} config)`, { timeout: 20000 }, async (t) => {
    try { execFileSync('tmux', ['-V']); } catch { t.skip('tmux unavailable'); return; }
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-scroll-'));
    const home = path.join(temp, 'home with spaces');
    const xdg = path.join(home, '.config');
    const conf = useXdg ? path.join(xdg, 'tmux', 'tmux.conf') : path.join(home, '.tmux.conf');
    const socket = path.join(temp, 'socket');
    await fs.mkdir(path.dirname(conf), { recursive: true });
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: xdg, ZDOTDIR: home,
      TMUX: '', TMUX_PANE: '', TMUX_WEB_SOCKET_PATH: socket, TMUX_WEB_SOCKET_NAME: '',
      TERM: 'xterm-256color', SHELL: '/bin/bash', TMUX_WEB_AUTO_START: '0' };
    const run = args => execFileSync('tmux', ['-S', socket, ...args], { env, encoding: 'utf8' }).trim();
    let client;
    t.after(async () => {
      try { client?.kill(); } catch {}
      try { run(['kill-server']); } catch {}
      // 終了中のシェルが履歴ファイルを書き終えるまで待つ。
      await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
    const oldConf = 'set -g mouse off\nset -g prefix C-a\n';
    await fs.writeFile(conf, oldConf);
    execFileSync('bash', [installer], { env });
    const installed = await fs.readFile(conf, 'utf8');
    assert.ok(installed.startsWith(oldConf));
    const backup = (await fs.readdir(path.dirname(conf))).find(name => name.startsWith(`${path.basename(conf)}.tmux-web-backup-`));
    assert.equal(await fs.readFile(path.join(path.dirname(conf), backup), 'utf8'), oldConf);

    // 新規サーバにも設定が読み込まれ、既存の個人設定は残る。
    run(['-f', conf, 'new-session', '-d', '-s', 'scroll', '/bin/bash --noprofile --norc']);
    assert.equal(run(['show-options', '-gv', 'mouse']), 'on');
    assert.equal(run(['show-options', '-gv', 'prefix']), 'C-a');
    assert.equal(run(['show-options', '-gv', 'history-limit']), '50000');
    // 導入前から起動中のサーバにも、再起動なしで設定を反映する。
    run(['set-option', '-g', 'mouse', 'off']);
    run(['bind-key', '-n', 'WheelUpPane', 'send-keys', 'Up']);
    execFileSync('bash', [installer], { env });
    assert.equal(await fs.readFile(conf, 'utf8'), installed);
    assert.equal(run(['show-options', '-gv', 'mouse']), 'on');
    assert.equal(run(['show-options', '-gv', 'prefix']), 'C-a');

    // Reloads/plugins can replace wheel bindings after setup. A new browser
    // attachment repairs them without rerunning the installer or restarting tmux.
    run(['bind-key', '-n', 'WheelUpPane', 'copy-mode', '-e']);
    run(['bind-key', '-n', 'WheelDownPane', 'send-keys', 'Down']);
    const oldSocket = process.env.TMUX_WEB_SOCKET_PATH;
    const oldName = process.env.TMUX_WEB_SOCKET_NAME;
    const oldMouse = process.env.TMUX_WEB_MOUSE;
    try {
      process.env.TMUX_WEB_SOCKET_PATH = socket;
      delete process.env.TMUX_WEB_SOCKET_NAME;
      delete process.env.TMUX_WEB_MOUSE;
      const { createAttachment } = await import('../src/attach.js');
      const attachment = await createAttachment({ sessionId: 'scroll' });
      await attachment.dispose();
      assert.match(run(['list-keys', '-T', 'root', 'WheelUpPane']), /PPage/);
      assert.match(run(['list-keys', '-T', 'root', 'WheelDownPane']), /NPage/);
    } finally {
      for (const [key, value] of Object.entries({ TMUX_WEB_SOCKET_PATH: oldSocket, TMUX_WEB_SOCKET_NAME: oldName, TMUX_WEB_MOUSE: oldMouse })) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }

    client = pty.spawn('tmux', ['-S', socket, 'attach-session', '-t', 'scroll'], {
      env, cwd: home, cols: 80, rows: 24,
    });
    let output = '';
    client.onData(data => { output += data; });
    await waitFor(() => output.includes('\x1b[?1006h'));
    client.write("printf 'history-%s\\n' {1..100}\r");
    await waitFor(() => run(['capture-pane', '-p']).includes('history-100'));
    const wheelUp = '\x1b[<64;5;5M';
    client.write(wheelUp);
    await waitFor(() => run(['display-message', '-p', '#{pane_in_mode}']) === '1');
    client.write(wheelUp);
    await waitFor(() => Number(run(['display-message', '-p', '#{scroll_position}'])) > 0);
    client.write('q');
    await waitFor(() => run(['display-message', '-p', '#{pane_in_mode}']) === '0');

    // 全画面CLIの履歴は tmux に存在しない。ホイールはアプリに
    // PageUp/PageDown として渡し、入力欄の Up/Down 履歴操作を避ける。
    const alternateApp = path.join(temp, 'alternate-app.cjs');
    const alternateReport = path.join(temp, 'alternate-input');
    await fs.writeFile(alternateApp, `const fs = require('node:fs');
process.stdin.setRawMode(true);
process.stdout.write('\\x1b[?1049h');
process.stdin.on('data', data => {
  fs.appendFileSync(${JSON.stringify(alternateReport)}, data);
  if (data.includes(3)) { process.stdout.write('\\x1b[?1049l'); process.exit(); }
});
`);
    client.write(`'${process.execPath}' '${alternateApp}'\r`);
    await waitFor(() => run(['display-message', '-p', '#{alternate_on}']) === '1');
    const wheelDown = '\x1b[<65;5;5M';
    client.write(wheelUp);
    await waitFor(async () => { try { return (await fs.readFile(alternateReport, 'utf8')).includes('\x1b[5~'); } catch { return false; } });
    client.write(wheelDown);
    await waitFor(async () => (await fs.readFile(alternateReport, 'utf8')).includes('\x1b[6~'));
    assert.equal(run(['display-message', '-p', '#{pane_in_mode}']), '0');
    const received = await fs.readFile(alternateReport, 'utf8');
    assert.ok(!received.includes('\x1b[A') && !received.includes('\x1b[B'), 'do not recall composer input history');

    // 明示的に copy-mode に入った場合は、全画面CLIへ PageUp を送らない。
    run(['copy-mode']);
    client.write(wheelUp);
    await waitFor(() => Number(run(['display-message', '-p', '#{scroll_position}'])) > 0);
    assert.equal(await fs.readFile(alternateReport, 'utf8'), received);
    client.write('q');
    await waitFor(() => run(['display-message', '-p', '#{pane_in_mode}']) === '0');
    client.write('\x03');
    await waitFor(() => run(['display-message', '-p', '#{alternate_on}']) === '0');

    // Codex は通常画面でもアプリへ送る。classic Claude は無視するため
    // 履歴を使い、fullscreen Claude は alternate/mouse の経路で扱う。
    for (const name of ['codex', 'claude']) {
      const executable = path.join(temp, name);
      const normalApp = path.join(temp, `${name}-app.cjs`);
      const normalReport = path.join(temp, `${name}-input`);
      await fs.symlink(process.execPath, executable);
      await fs.writeFile(normalApp, `const fs = require('node:fs');
process.stdin.setRawMode(true);
process.stdin.on('data', data => {
  fs.appendFileSync(${JSON.stringify(normalReport)}, data);
  if (data.includes(3)) process.exit();
});
process.stdout.write('normal-agent-ready-${name}');
`);
      client.write(`'${executable}' '${normalApp}'\r`);
      await waitFor(() => run(['display-message', '-p', '#{pane_current_command}']) === name);
      // The previous agent's marker remains visible after it exits. Wait for
      // this process to enter raw mode and install its input listener.
      await waitFor(() => run(['capture-pane', '-p']).includes(`normal-agent-ready-${name}`));
      assert.equal(run(['display-message', '-p', '#{alternate_on}']), '0');
      client.write(wheelUp);
      if (name === 'claude') {
        // Classic Claude has no internal viewport and ignores PageUp. Keep its
        // rendered history scrollable without feeding keys into the composer.
        await waitFor(() => run(['display-message', '-p', '#{pane_in_mode}']) === '1');
        client.write('q');
        await waitFor(() => run(['display-message', '-p', '#{pane_in_mode}']) === '0');
        await assert.rejects(fs.access(normalReport));
        client.write('\x03');
        await waitFor(() => run(['display-message', '-p', '#{pane_current_command}']) === 'bash');
        continue;
      }
      await waitFor(async () => { try { return (await fs.readFile(normalReport, 'utf8')).includes('\x1b[5~'); } catch { return false; } });
      client.resize(120, 24);
      await waitFor(() => run(['display-message', '-p', '#{pane_width}']) === '120');
      client.write(wheelDown);
      await waitFor(async () => (await fs.readFile(normalReport, 'utf8')).includes('\x1b[6~'));
      assert.equal(run(['display-message', '-p', '#{pane_in_mode}']), '0');
      client.write('\x03');
      await waitFor(() => run(['display-message', '-p', '#{pane_current_command}']) === 'bash');
      client.resize(80, 24);
      await waitFor(() => run(['display-message', '-p', '#{pane_width}']) === '80');
    }

    // アプリがマウス入力を要求している場合は、ホイールをそのまま届ける。
    const app = path.join(temp, 'mouse-app.cjs');
    const report = path.join(temp, 'mouse-input');
    await fs.writeFile(app, `const fs = require('node:fs');
process.stdin.setRawMode(true);
process.stdout.write('\\x1b[?1000h\\x1b[?1006h');
process.stdin.on('data', data => fs.appendFileSync(${JSON.stringify(report)}, data));
`);
    client.write(`'${process.execPath}' '${app}'\r`);
    await waitFor(() => run(['display-message', '-p', '#{mouse_any_flag}']) === '1');
    client.write(wheelUp);
    await waitFor(async () => { try { return (await fs.readFile(report, 'utf8')).includes(wheelUp); } catch { return false; } });
    assert.equal(run(['display-message', '-p', '#{pane_in_mode}']), '0');
    client.write(wheelDown);
    await waitFor(async () => (await fs.readFile(report, 'utf8')).includes(wheelDown));

    // 分割画面では、アクティブなペインではなくポインター下のアプリへ渡す。
    const mousePane = run(['display-message', '-p', '#{pane_id}']);
    run(['split-window', '-h', '/bin/bash --noprofile --norc']);
    assert.equal(run(['display-message', '-p', '-t', mousePane, '#{pane_active}']), '0');
    const previousSize = (await fs.stat(report)).size;
    client.write(wheelUp);
    await waitFor(async () => (await fs.stat(report)).size > previousSize);
    assert.equal(run(['display-message', '-p', '#{pane_id}']), mousePane);
  });
}

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
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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
