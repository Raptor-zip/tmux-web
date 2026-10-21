import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { installProjects } from '../src/projects/index.js';
import { cancel } from '../src/projects/askpass.js';
import { toDirName } from '../src/projects/projects.js';

async function fixture(t) {
  const app = express();
  installProjects(app, 'test-token');
  app.use(express.json());
  app.post('/api/existing', (req, res) => res.json(req.body));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = (url, init = {}) => fetch(base + '/projects' + url, { ...init, headers: { 'x-tmux-web-token': 'test-token', ...init.headers } });
  const post = (url, body, headers = {}) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { base, api, post };
}

test('project module shares token authentication, serves prefixed assets and rejects cross-site writes', async t => {
  const { base, api, post } = await fixture(t);
  assert.equal((await fetch(base + '/projects/api/sessions')).status, 401);
  assert.equal((await fetch(base + '/projects/', { headers: { Host: 'localhost', 'tailscale-user-login': 'anyone' } })).status, 401);
  const login = await fetch(base + '/projects/?token=test-token', { redirect: 'manual' });
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), '/projects/');
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const page = await fetch(base + '/projects/', { headers: { cookie: login.headers.get('set-cookie').split(';')[0] } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /\/projects\/app.js/);
  const script = await api('/app.js');
  assert.equal(script.status, 200);
  assert.match(await script.text(), /\/projects\/api\/sessions/);
  assert.equal((await post('/api/projects', { name: 'test' }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post('/api/projects', { name: '' })).status, 400);
  const normal = await fetch(base + '/api/existing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"preserved":true}' });
  assert.deepEqual(await normal.json(), { preserved: true });
  assert.equal(toDirName('../../日本語/テスト'), '日本語-テスト');
});

test('uploads preserve files, protected paths stay private, and archives exclude secrets', async t => {
  const { api } = await fixture(t);
  const dir = await fs.mkdtemp(path.join(os.homedir(), 'tmux-web-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'input.txt'), 'original');
  await fs.mkdir(path.join(dir, '.ssh'));
  await fs.writeFile(path.join(dir, '.ssh', 'key'), 'private');
  await fs.symlink('/etc/passwd', path.join(dir, 'outside'));
  const form = new FormData();
  form.append('file', new Blob(['uploaded']), 'input.txt');
  const upload = await api('/api/upload?path=' + encodeURIComponent(dir), { method: 'POST', body: form });
  assert.equal(upload.status, 200);
  assert.deepEqual((await upload.json()).saved, ['input-2.txt']);
  assert.equal(await fs.readFile(path.join(dir, 'input.txt'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(dir, 'input-2.txt'), 'utf8'), 'uploaded');
  const listing = await (await api('/api/files?path=' + encodeURIComponent(dir))).json();
  assert.ok(!listing.entries.some(x => x.name === 'outside'));
  for (const file of ['/etc/passwd', '~/.config', '~/.codex']) {
    assert.equal((await api('/api/file?path=' + encodeURIComponent(file))).status, 403);
  }
  const preview = await api('/api/file?path=' + encodeURIComponent(path.join(dir, 'input.txt')));
  assert.equal(await preview.text(), 'original');
  assert.match(preview.headers.get('content-security-policy'), /sandbox/);
  const archive = await api('/api/zip?path=' + encodeURIComponent(dir));
  assert.equal(archive.status, 200);
  const names = execFileSync('tar', ['-tzf', '-'], { input: Buffer.from(await archive.arrayBuffer()), encoding: 'utf8' });
  assert.match(names, /input-2.txt/);
  assert.doesNotMatch(names, /\.ssh/);
});

test('local sudo helper exchanges an answer once; remote helpers, wrong claims, and cross-site answers fail', async t => {
  const { base, api, post } = await fixture(t);
  const created = await fetch(base + '/projects/api/askpass/request', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'test-only', cwd: os.homedir() }),
  });
  assert.equal(created.status, 200);
  const { id, claim } = await created.json();
  t.after(() => cancel());
  const pending = await (await api('/api/askpass/pending')).json();
  assert.equal(pending.pending.cmd, 'test-only');
  assert.equal(pending.pending.claim, undefined);
  assert.equal((await post('/api/askpass/request', {}, { 'X-Forwarded-For': '100.64.0.2' })).status, 403);
  assert.equal((await api(`/api/askpass/wait?id=${id}&claim=wrong`)).status, 404);
  assert.equal((await fetch(base + '/projects/api/askpass/request', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 401);
  const waiting = fetch(`${base}/projects/api/askpass/wait?id=${id}&claim=${claim}`);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await api(`/api/askpass/wait?id=${id}&claim=${claim}`)).status, 404);
  assert.equal((await post('/api/askpass/answer', { id, password: 'dummy-test-value' }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post('/api/askpass/answer', { id, password: 'dummy-test-value' })).status, 200);
  assert.equal(await (await waiting).text(), 'dummy-test-value');
  assert.equal((await api(`/api/askpass/wait?id=${id}&claim=${claim}`)).status, 404);
  assert.equal((await api('/api/askpass/pending')).status, 200);
});

test('project creation and history resume use isolated tmux commands with quoted titles', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmux-project-start-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const bin = path.join(temp, 'bin');
  await fs.mkdir(bin);
  const log = path.join(temp, 'tmux.jsonl');
  await fs.writeFile(path.join(bin, 'tmux'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TMUX_TEST_LOG, JSON.stringify(args)+'\\n');
if (args[0] === 'capture-pane') process.exit(1);
if (args[0] === 'list-panes') console.log('%999');
`, { mode: 0o755 });
  const module = new URL('../src/projects/projects.js', import.meta.url).href;
  const sessions = new URL('../src/projects/sessions.js', import.meta.url).href;
  const script = `import { createProject } from ${JSON.stringify(module)};
import { startSession } from ${JSON.stringify(sessions)};
const created = await createProject({name:'日本語 test',template:'node',initialPrompt:'hello'});
await startSession({dir:created.dir,title:"quote' title",resumeId:'example-session-id'});
console.log(JSON.stringify(created));`;
  const { promisify } = await import('node:util');
  const { execFile } = await import('node:child_process');
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, HOME: temp, PATH: `${bin}:${process.env.PATH}`, TMUX_TEST_LOG: log }, timeout: 10000,
  });
  const created = JSON.parse(stdout);
  assert.equal(created.paneId, '%999');
  assert.equal(JSON.parse(await fs.readFile(path.join(created.dir, 'package.json'), 'utf8')).private, true);
  assert.equal(await fs.stat(path.join(created.dir, '.git')).then(s => s.isDirectory()), true);
  const commands = (await fs.readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  const launches = commands.filter(args => args[0] === 'new-session');
  assert.equal(launches.length, 2);
  assert.match(launches[0].at(-1), /--remote-control/);
  assert.match(launches[1].at(-1), /--resume 'example-session-id'/);
  assert.match(launches[1].at(-1), /quote'\\'' title/);
});
