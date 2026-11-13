import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

// Exercise the real Bash wizard with isolated config and fake external commands.
// Never install packages, contact a remote, or restart the user's real service.
const userTest = (name, fn) => test(name, { skip: process.getuid?.() === 0 ? 'wizard must run as an ordinary user' : false }, fn);
async function fixture(t, { installed = true, ...overrides } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tmux install '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin'), scripts = path.join(dir, 'scripts');
  const unitDir = path.join(dir, 'config/systemd/user');
  await Promise.all([mkdir(bin), mkdir(scripts), mkdir(unitDir, { recursive: true })]);
  await copyFile(new URL('../../install.sh', import.meta.url), path.join(dir, 'install.sh'));
  const unit = path.join(unitDir, 'tmux-web.service');
  if (installed) await writeFile(unit, 'custom unit: PORT=9999, custom Node and allowed users\n');
  const command = async (name, body) => writeFile(path.join(bin, name), `#!/usr/bin/env bash\nprintf '%s\\n' '${name}'" $*" >> "$TEST_CALLS"\n${body}\n`, { mode: 0o755 });
  await command('git', `case "$*" in
    'status --porcelain') printf '%s' "\${TEST_DIRTY:-}" ;;
    *'@{upstream}'*) [[ "\${TEST_NO_UPSTREAM:-0}" != 1 ]] ;;
    'rev-parse HEAD') cat "$TEST_HEAD" ;;
    'pull --ff-only')
      [[ "\${TEST_PULL_FAIL:-0}" != 1 ]] || exit 1
      [[ "\${TEST_CHANGE_HEAD:-0}" != 1 ]] || printf 'new' > "$TEST_HEAD" ;;
    *) exit 1 ;;
  esac`);
  await command('npm', '[[ "\${TEST_BUILD_FAIL:-0}" != 1 || "$*" != "run build" ]]');
  await command('systemctl', '[[ "\${TEST_NOT_ACTIVE:-0}" != 1 || "$*" != *is-active* ]]');
  await command('tailscale', 'printf \'{"BackendState":"Running"}\\n\'');
  await command('sleep', ':');
  await command('sudo', '"$@"');
  await command('apt-get', ':');
  for (const name of ['tmux', 'loginctl', 'x11vnc', 'xrandr', 'xclip']) await command(name, ':');
  for (const name of ['install-service.sh', 'install-terminal-tmux.sh', 'install-persistence.sh', 'resurrect-autosave.sh', 'import-desktop-environment.sh', 'tailscale-serve.sh']) {
    await writeFile(path.join(scripts, name), `#!/usr/bin/env bash\nprintf '%s\\n' '${name}'" $*" >> "$TEST_CALLS"\n${name === 'tailscale-serve.sh' ? '[[ "${1:-}" != url ]] || printf "https://test.example:8443/\\n"' : ':'}\n`);
  }
  const head = path.join(dir, 'head'); await writeFile(head, 'old');
  const callsFile = path.join(dir, 'calls');
  const bashEnv = path.join(dir, 'test-env.sh');
  await writeFile(bashEnv, 'command() { if [[ "$1" == -v && " ${TEST_MISSING:-} " == *" $2 "* ]]; then return 1; fi; builtin command "$@"; }\n');
  const env = { ...process.env, BASH_ENV: bashEnv, HOME: dir, XDG_CONFIG_HOME: path.join(dir, 'config'), PATH: `${bin}:${process.env.PATH}`, TEST_CALLS: callsFile, TEST_HEAD: head, ...overrides };
  return {
    unit,
    calls: () => readFile(callsFile, 'utf8').catch(() => ''),
    run(input, args = []) {
      return new Promise(resolve => {
        const child = execFile('bash', [path.join(dir, 'install.sh'), ...args], { env, timeout: 10000 }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }));
        child.stdin.on('error', () => {});
        child.stdin.end(input);
      });
    },
  };
}

userTest('installed wizard updates with two Enters and preserves the entire service config', async t => {
  const f = await fixture(t);
  const before = await readFile(f.unit, 'utf8');
  const result = await f.run('\n\n');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /完了しました/);
  assert.match(result.stdout, /https:\/\/test.example:8443/);
  const calls = await f.calls();
  assert.match(calls, /git pull --ff-only/);
  assert.match(calls, /npm ci\nnpm run build\nimport-desktop-environment.sh --import-only\nsystemctl --user restart tmux-web.service/);
  assert.doesNotMatch(calls, /install-service.sh|install-persistence.sh|install-terminal-tmux.sh/);
  assert.equal(await readFile(f.unit, 'utf8'), before);
});

userTest('new installation applies only selected features', async t => {
  const f = await fixture(t, { installed: false });
  const result = await f.run('\nn\n\n\n\n');
  assert.equal(result.code, 0, result.stderr);
  const calls = await f.calls();
  assert.match(calls, /install-service.sh/);
  assert.match(calls, /install-persistence.sh *\nresurrect-autosave.sh/);
  assert.match(calls, /tailscale-serve.sh/);
  assert.doesNotMatch(calls, /install-terminal-tmux.sh/);
});

userTest('setup can add shell integration without enabling other features', async t => {
  const f = await fixture(t);
  const result = await f.run('2\nn\ny\nn\nn\ny\n');
  assert.equal(result.code, 0, result.stderr);
  const calls = await f.calls();
  assert.match(calls, /install-terminal-tmux.sh/);
  assert.doesNotMatch(calls, /install-persistence.sh|tailscale status/);
});

userTest('missing desktop packages are installed together only after confirmation', async t => {
  const f = await fixture(t, { installed: false, TEST_MISSING: 'tmux x11vnc xclip' });
  const result = await f.run('y\nn\nn\nn\ny\ny\n');
  assert.equal(result.code, 0, result.stderr);
  const calls = await f.calls();
  assert.match(calls, /sudo apt-get update/);
  assert.match(calls, /sudo apt-get install -y tmux x11vnc xclip/);
  assert.match(calls, /install-service.sh/);
});

userTest('declining missing packages stops before installation or service changes', async t => {
  const f = await fixture(t, { installed: false, TEST_MISSING: 'tmux' });
  const result = await f.run('n\nn\nn\nn\ny\nn\n');
  assert.notEqual(result.code, 0);
  assert.doesNotMatch(await f.calls(), /sudo |apt-get |install-service.sh/);
});

userTest('dirty checkout stops before pulling, building, or restarting', async t => {
  const f = await fixture(t, { TEST_DIRTY: ' M important-file' });
  const result = await f.run('\n\n');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /未コミット/);
  assert.doesNotMatch(await f.calls(), /git pull|npm |restart/);
});

userTest('no-update applies local changes without contacting Git', async t => {
  const f = await fixture(t, { TEST_DIRTY: ' M important-file' });
  const result = await f.run('\n\n', ['--no-update']);
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(await f.calls(), /git /);
  assert.match(await f.calls(), /npm run build/);
});

userTest('failed fast-forward stops before npm and explains the failed step', async t => {
  const f = await fixture(t, { TEST_PULL_FAIL: '1' });
  const result = await f.run('\n\n');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /最新版の取得/);
  assert.doesNotMatch(await f.calls(), /npm |restart/);
});

userTest('missing upstream gives a local-code alternative', async t => {
  const f = await fixture(t, { TEST_NO_UPSTREAM: '1' });
  const result = await f.run('\n\n');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /追跡先が未設定/);
  assert.match(result.stderr, /--no-update/);
  assert.doesNotMatch(await f.calls(), /git pull|npm |restart/);
});

userTest('build failure leaves the running service alone', async t => {
  const f = await fixture(t, { TEST_BUILD_FAIL: '1' });
  const result = await f.run('\n\n');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /画面のビルド/);
  assert.doesNotMatch(await f.calls(), /restart|import-desktop/);
});

userTest('failed service startup reports the log command without claiming success', async t => {
  const f = await fixture(t, { TEST_NOT_ACTIVE: '1' });
  const result = await f.run('\n\n');
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /journalctl --user -u tmux-web -n 40/);
  assert.doesNotMatch(result.stdout, /完了しました/);
  assert.match(await f.calls(), /systemctl --user status tmux-web.service/);
});

userTest('updated wizard reexecutes without pulling twice', async t => {
  const f = await fixture(t, { TEST_CHANGE_HEAD: '1' });
  const result = await f.run('\n\n');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /最新版のウィザード/);
  assert.equal((await f.calls()).match(/git pull/g).length, 1);
  assert.equal((await f.calls()).match(/npm ci/g).length, 1);
});

userTest('new wizard keeps feature selections after updating its own code', async t => {
  const f = await fixture(t, { installed: false, TEST_CHANGE_HEAD: '1' });
  const result = await f.run('n\ny\nn\nn\ny\n');
  assert.equal(result.code, 0, result.stderr);
  const calls = await f.calls();
  assert.match(calls, /install-terminal-tmux.sh/);
  assert.doesNotMatch(calls, /install-persistence.sh|tailscale status/);
  assert.equal(calls.match(/git pull/g).length, 1);
});

userTest('cancellation, EOF, help and invalid flags cause no external mutations', async t => {
  for (const [input, args, code] of [['\nn\n', [], 0], ['', [], 1], ['', ['--help'], 0], ['', ['--invalid'], 1]]) {
    const f = await fixture(t);
    const result = await f.run(input, args);
    assert.equal(result.code, code, result.stderr);
    assert.equal(await f.calls(), '');
  }
});
