import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import express from 'express';
import { installFiles } from '../src/files.js';

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmux-web-files-'));
  const root = path.join(temp, 'project');
  await fs.mkdir(path.join(root, 'out'), { recursive: true });
  await fs.writeFile(path.join(root, 'out', '日本語 image.png'), '0123456789');
  await fs.writeFile(path.join(root, '.env'), 'SECRET');
  await fs.writeFile(path.join(root, 'empty.txt'), '');
  await fs.writeFile(path.join(root, 'page.html'), '<script>alert(1)</script>');
  await fs.writeFile(path.join(temp, 'outside.txt'), 'PRIVATE');
  await fs.symlink(path.join(temp, 'outside.txt'), path.join(root, 'outside-link.txt'));
  await fs.symlink(path.join(root, '.env'), path.join(root, 'hidden-link.txt'));
  let clock = Date.now();
  const app = express();
  app.use(express.json());
  app.use('/api', (req, res, next) => req.headers['x-tmux-web-token'] === 'test-token'
    ? next() : res.status(401).json({ error: 'unauthorized' }));
  installFiles(app, async (id) => id === '%1' ? { project: { root } } : null, { now: () => clock });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = (url, init = {}) => fetch(base + url, { ...init, headers: {
    'x-tmux-web-token': 'test-token', 'Content-Type': 'application/json', ...init.headers,
  } });
  const open = async (file) => {
    const res = await api('/api/files/open', { method: 'POST', body: JSON.stringify({ pane: '%1', root, path: file }) });
    assert.equal(res.status, 200);
    return (await res.json()).url;
  };
  return { root, base, api, open, advance: () => { clock += 3600001; } };
}

test('authenticated listing, navigation, missing panes and confined paths', async (t) => {
  const { base, api } = await fixture(t);
  assert.equal((await fetch(base + '/api/files?pane=%251')).status, 401);
  const listing = await (await api('/api/files?pane=%251')).json();
  assert.deepEqual(listing.items.map((x) => x.name).sort(), ['empty.txt', 'out', 'page.html']);
  const sub = await (await api('/api/files?pane=%251&path=out')).json();
  assert.equal(sub.items[0].name, '日本語 image.png');
  assert.equal(sub.items[0].mime, 'image/png');
  assert.equal((await api('/api/files?pane=missing')).status, 404);
  assert.equal((await api('/api/files/open', { method: 'POST', body: JSON.stringify({ pane: '%1', root: '/old/project', path: 'empty.txt' }) })).status, 409);
  for (const file of ['../outside.txt', '/etc/passwd', 'outside-link.txt', 'hidden-link.txt', '.env', 'out/../../outside.txt']) {
    assert.equal((await api(`/api/files?pane=%251&path=${encodeURIComponent(file)}`)).status, 403, file);
  }
});

test('scoped media URLs, Unicode download names, HEAD and byte ranges', async (t) => {
  const { base, open } = await fixture(t);
  const url = await open('out/日本語 image.png');
  const full = await fetch(base + url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'image/png');
  assert.equal(await full.text(), '0123456789');
  assert.match(full.headers.get('content-disposition'), /inline.*filename\*=UTF-8''/);
  const download = await fetch(base + url + '&download=1');
  assert.match(download.headers.get('content-disposition'), /^attachment/);
  await download.arrayBuffer();
  const head = await fetch(base + url, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');
  for (const [range, expected] of [['bytes=2-5', '2345'], ['bytes=-3', '789'], ['bytes=8-', '89']]) {
    const res = await fetch(base + url, { headers: { Range: range } });
    assert.equal(res.status, 206);
    assert.equal(await res.text(), expected);
  }
  for (const range of ['bytes=20-', 'bytes=5-2', 'bytes=-0', 'bytes=0-1,3-4']) {
    const res = await fetch(base + url, { headers: { Range: range } });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('content-range'), 'bytes */10');
  }
  const empty = await fetch(base + await open('empty.txt'));
  assert.equal(await empty.text(), '');
  assert.equal(empty.headers.get('content-length'), '0');
  const html = await fetch(base + await open('page.html'));
  assert.equal(html.headers.get('content-type'), 'application/octet-stream');
  assert.match(html.headers.get('content-disposition'), /^attachment/);
  await html.arrayBuffer();
});

test('invalid, tampered and expired links, and symlink replacement after issuance', async (t) => {
  const { root, base, open, advance } = await fixture(t);
  assert.equal((await fetch(base + '/files/content')).status, 401);
  const url = await open('out/日本語 image.png');
  const token = new URL(base + url).searchParams.get('ticket');
  const [payload, signature] = token.split('.');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  data.path = '../outside.txt';
  const tampered = Buffer.from(JSON.stringify(data)).toString('base64url') + '.' + signature;
  assert.equal((await fetch(base + '/files/content?ticket=' + tampered)).status, 401);
  await fs.unlink(path.join(root, 'out', '日本語 image.png'));
  await fs.symlink(path.join(root, '..', 'outside.txt'), path.join(root, 'out', '日本語 image.png'));
  assert.equal((await fetch(base + url)).status, 403);
  advance();
  assert.equal((await fetch(base + url)).status, 401);
});
