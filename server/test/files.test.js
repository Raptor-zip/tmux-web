import { auth, headers as identityHeaders, fetch } from './helpers/tailscale.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import express from 'express';
import { installFiles } from '../src/files.js';

async function fixture(t, { rootName = 'project' } = {}) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tmux-web-files-'));
  const root = path.join(temp, rootName);
  const pasteDir = path.join(temp, 'paste');
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
  app.use(['/api', '/files'], auth().middleware);
  installFiles(app, async (id) => id === '%1' ? { project: { root } } : null, { now: () => clock, pasteDir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = (url, init = {}) => fetch(base + url, { ...init, headers: {
    ...identityHeaders, 'Content-Type': 'application/json', ...init.headers,
  } });
  const open = async (file) => {
    const res = await api('/api/files/open', { method: 'POST', body: JSON.stringify({ pane: '%1', root, path: file }) });
    assert.equal(res.status, 200);
    return (await res.json()).url;
  };
  return { root, pasteDir, base, api, open, advance: () => { clock += 3600001; } };
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
  const full = await fetch(base + url, { headers: identityHeaders });
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'image/png');
  assert.equal(await full.text(), '0123456789');
  assert.match(full.headers.get('content-disposition'), /inline.*filename\*=UTF-8''/);
  const download = await fetch(base + url + '&download=1', { headers: identityHeaders });
  assert.match(download.headers.get('content-disposition'), /^attachment/);
  await download.arrayBuffer();
  const head = await fetch(base + url, { method: 'HEAD', headers: identityHeaders });
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');
  for (const [range, expected] of [['bytes=2-5', '2345'], ['bytes=-3', '789'], ['bytes=8-', '89']]) {
    const res = await fetch(base + url, { headers: { ...identityHeaders, Range: range } });
    assert.equal(res.status, 206);
    assert.equal(await res.text(), expected);
  }
  for (const range of ['bytes=20-', 'bytes=5-2', 'bytes=-0', 'bytes=0-1,3-4']) {
    const res = await fetch(base + url, { headers: { ...identityHeaders, Range: range } });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('content-range'), 'bytes */10');
  }
  const empty = await fetch(base + await open('empty.txt'), { headers: identityHeaders });
  assert.equal(await empty.text(), '');
  assert.equal(empty.headers.get('content-length'), '0');
  const html = await fetch(base + await open('page.html'), { headers: identityHeaders });
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
  assert.equal((await fetch(base + '/files/content?ticket=' + tampered, { headers: identityHeaders })).status, 401);
  await fs.unlink(path.join(root, 'out', '日本語 image.png'));
  await fs.symlink(path.join(root, '..', 'outside.txt'), path.join(root, 'out', '日本語 image.png'));
  assert.equal((await fetch(base + url, { headers: identityHeaders })).status, 403);
  advance();
  assert.equal((await fetch(base + url, { headers: identityHeaders })).status, 401);
});

test('native uploads avoid overwrites and folder downloads preserve input assets while excluding secrets', async t => {
  const {root,base,api}=await fixture(t);
  const upload=(name,body)=>api(`/api/files/upload?${new URLSearchParams({pane:'%1',root,path:'out',name})}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body});
  assert.equal((await upload('new.txt','first')).status,200);
  assert.deepEqual(await (await upload('new.txt','second')).json(),{name:'new-2.txt'});
  assert.equal(await fs.readFile(path.join(root,'out','new.txt'),'utf8'),'first');
  assert.equal((await upload('../outside.txt','blocked')).status,400);
  assert.equal((await upload('.env','blocked')).status,400);
  await fs.symlink('/etc/passwd',path.join(root,'out','link.txt'));
  assert.deepEqual(await (await upload('link.txt','safe')).json(),{name:'link-2.txt'});
  assert.equal(await fs.readFile(path.join(root,'out','link-2.txt'),'utf8'),'safe');
  const archive=await api('/api/files/archive',{method:'POST',body:JSON.stringify({pane:'%1',root,path:''})});
  const {url}=await archive.json();const data=await fetch(base+url, { headers: identityHeaders });
  assert.equal(data.status,200);
  const {execFileSync}=await import('node:child_process');
  const names=execFileSync('tar',['-tzf','-'],{input:Buffer.from(await data.arrayBuffer()),encoding:'utf8'});
  assert.match(names,/new-2.txt/);assert.doesNotMatch(names,/\.env/);
  const rejected=await api('/api/files/archive',{method:'POST',body:JSON.stringify({pane:'%1',root,path:'..'})});
  assert.equal(rejected.status,403);
});

test('empty regular files can be uploaded and attached without accepting an empty image', async t => {
  const { root, api, pasteDir } = await fixture(t);
  const upload = await api(`/api/files/upload?${new URLSearchParams({ pane: '%1', root, path: 'out', name: 'zero.txt' })}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(0),
  });
  assert.equal(upload.status, 200);
  assert.equal((await fs.stat(path.join(root, 'out', 'zero.txt'))).size, 0);
  const attachment = await api('/api/paste-file?name=zero.txt', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(0) });
  assert.equal(attachment.status, 200);
  const file = (await attachment.json()).path;
  assert.equal(path.dirname(file), pasteDir);
  assert.equal((await fs.stat(file)).size, 0);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const image = await api('/api/paste-image', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.alloc(0) });
  assert.equal(image.status, 400);
  assert.equal((await api('/api/paste-file?name=bad.txt', { method: 'POST', body: '{}' })).status, 400);
});

test('long Unicode names fit the filesystem, retain extensions and never overwrite an earlier upload', async t => {
  const { root, api, pasteDir } = await fixture(t);
  const name = '日本語'.repeat(40) + '.txt';
  const upload = body => api(`/api/files/upload?${new URLSearchParams({ pane: '%1', root, path: 'out', name })}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body,
  });
  const first = await upload('first'); assert.equal(first.status, 200);
  const a = (await first.json()).name;
  const second = await upload('second'); assert.equal(second.status, 200);
  const b = (await second.json()).name;
  assert.notEqual(a, b);
  for (const saved of [a, b]) { assert.ok(Buffer.byteLength(saved) <= 240); assert.ok(saved.endsWith('.txt')); assert.ok(!saved.includes('�')); }
  assert.equal(await fs.readFile(path.join(root, 'out', a), 'utf8'), 'first');
  assert.equal(await fs.readFile(path.join(root, 'out', b), 'utf8'), 'second');
  const attached = await api('/api/paste-file?' + new URLSearchParams({ name }), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: 'attached' });
  assert.equal(attached.status, 200);
  const file = (await attached.json()).path;
  assert.equal(path.dirname(file), pasteDir);
  assert.ok(Buffer.byteLength(path.basename(file)) <= 255);
  assert.ok(file.endsWith('.txt'));
  assert.ok(!file.includes('�'));
  assert.equal(await fs.readFile(file, 'utf8'), 'attached');
});

test('image content types are case insensitive and attachments use private files', async t => {
  const { api, pasteDir } = await fixture(t);
  const result = await api('/api/paste-image', { method: 'POST', headers: { 'Content-Type': 'IMAGE/PNG; charset=binary' }, body: Buffer.from('image fixture') });
  assert.equal(result.status, 200);
  const file = (await result.json()).path;
  assert.equal(path.dirname(file), pasteDir);
  assert.ok(file.endsWith('.png'));
  assert.equal((await fs.stat(pasteDir)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.equal(await fs.readFile(file, 'utf8'), 'image fixture');
});

test('a dot-prefixed project root still archives manual assets and excludes hidden descendants', async t => {
  const { root, base, api } = await fixture(t, { rootName: '.project' });
  await fs.mkdir(path.join(root, 'public'), { recursive: true });
  await fs.writeFile(path.join(root, 'public', 'manual-logo.svg'), '<svg>fixture asset</svg>');
  for (const name of ['.private', 'node_modules', '__pycache__']) {
    await fs.mkdir(path.join(root, 'public', name));
    await fs.writeFile(path.join(root, 'public', name, 'excluded.txt'), 'EXCLUDED');
  }
  const issued = await api('/api/files/archive', { method: 'POST', body: JSON.stringify({ pane: '%1', root, path: '' }) });
  assert.equal(issued.status, 200);
  const response = await fetch(base + (await issued.json()).url, { headers: identityHeaders });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  const { execFileSync } = await import('node:child_process');
  const names = execFileSync('tar', ['-tzf', '-'], { input: bytes, encoding: 'utf8' });
  assert.match(names, /\.project\/public\/manual-logo\.svg/);
  assert.doesNotMatch(names, /\.env|\.private|node_modules|__pycache__/);
  const content = execFileSync('tar', ['-xOzf', '-', '.project/public/manual-logo.svg'], { input: bytes, encoding: 'utf8' });
  assert.equal(content, '<svg>fixture asset</svg>');
});
