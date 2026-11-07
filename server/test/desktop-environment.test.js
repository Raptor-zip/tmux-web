import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const script = new URL('../../scripts/import-desktop-environment.sh', import.meta.url).pathname;
async function run(t, overrides = {}, args = []) {
  const dir = await mkdtemp(path.join(tmpdir(), 'desktop-environment-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'loginctl'), `#!/bin/sh
[ "$TEST_LOGIND_FAIL" != 1 ] || exit 1
case "$*" in
 *--property=Seat*) printf '%s\\n' "$TEST_SEAT" ;;
 *--property=Type*) printf '%s\\n' "$TEST_TYPE" ;;
 *) exit 1 ;;
esac
`, { mode: 0o755 });
  await writeFile(path.join(dir, 'systemctl'), `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_CALLS"
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, DISPLAY: ':1', XAUTHORITY: '/run/user/1000/gdm/Xauthority', XDG_SESSION_ID: '207', TEST_SEAT: 'seat0', TEST_TYPE: 'x11', TEST_LOGIND_FAIL: '0', TEST_CALLS: path.join(dir, 'calls'), ...overrides };
  await exec('bash', [script, ...args], { env });
  return readFile(env.TEST_CALLS, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
}
test('physical X11 login imports its display and authentication before restarting', async t => {
  assert.equal(await run(t), '--user import-environment DISPLAY\n--user import-environment XAUTHORITY\n--user try-restart tmux-web.service\n');
});
test('XRDP X11 session with no seat cannot replace the physical display', async t => {
  assert.equal(await run(t, { DISPLAY: ':10.0', TEST_SEAT: '', XDG_SESSION_ID: 'c94' }), '');
});
test('Wayland cannot replace the X11 environment even with a seat', async t => {
  assert.equal(await run(t, { TEST_TYPE: 'wayland' }), '');
});
test('missing display or unavailable logind leaves running service alone', async t => {
  assert.equal(await run(t, { DISPLAY: '' }), '');
  assert.equal(await run(t, { TEST_LOGIND_FAIL: '1' }), '');
});
test('physical login without XAUTHORITY clears stale authentication', async t => {
  assert.equal(await run(t, { XAUTHORITY: '' }), '--user import-environment DISPLAY\n--user unset-environment XAUTHORITY\n--user try-restart tmux-web.service\n');
});
test('installer imports physical environment without restarting early', async t => {
  assert.equal(await run(t, {}, ['--import-only']), '--user import-environment DISPLAY\n--user import-environment XAUTHORITY\n');
  assert.equal(await run(t, { TEST_SEAT: '', DISPLAY: ':10.0' }, ['--import-only']), '');
});
