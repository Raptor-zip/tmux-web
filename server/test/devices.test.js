import { auth, headers as identityHeaders, fetch } from './helpers/tailscale.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { once } from 'node:events';
import { createDevices, validateDevice } from '../src/devices.js';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-devices-'));
  const file = path.join(dir, 'devices.json');
  const upstream = http.createServer((req, res) => {
    assert.equal(req.headers['x-tmux-web-token'], undefined);
    assert.equal(req.headers['tailscale-user-login'], undefined);
    if (req.url.startsWith('/files/content')) { res.writeHead(206, { 'Content-Type': 'text/plain', 'Content-Range': 'bytes 1-3/5' }).end('bcd'); return; }
    const parts = [];
    req.on('data', chunk => parts.push(chunk));
    req.on('end', () => res.setHeader('Content-Type', 'application/json').end(JSON.stringify({ url: req.url, body: Buffer.concat(parts).toString(), cookie: req.headers.cookie || null })));
  });
  const remoteWs = new WebSocketServer({ noServer: true });
  upstream.on('upgrade', (req, socket, head) => {
    assert.equal(new URL(req.url, 'http://localhost').searchParams.has('token'), false);
    assert.equal(req.headers['tailscale-user-login'], undefined);
    remoteWs.handleUpgrade(req, socket, head, ws => {
      ws.on('message', (data, binary) => ws.send(data, { binary }));
    });
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const devices = createDevices({ file });
  const app = express(); app.use(express.json());
  const authentication = auth();
  app.use('/api', authentication.middleware);
  devices.install(app);
  const server = http.createServer(app);
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (authentication.authorize(req).status !== 200) return socket.destroy();
    if (!devices.upgrade(req, socket, head, url)) socket.destroy();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = (url, init = {}) => fetch(base + url, { ...init, headers: { ...identityHeaders, 'Content-Type': 'application/json', ...init.headers } });
  const created = await api('/api/devices', { method: 'POST', body: JSON.stringify({ name: 'Spark', url: `http://127.0.0.1:${upstream.address().port}`, token: 'remote-secret' }) });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  t.after(async () => {
    devices.dispose(); remoteWs.close();
    for (const s of [server, upstream]) { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)); }
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { api, base, id, file, devices, upstream };
}

test('registration is authenticated, validates URLs and removes legacy credentials', async t => {
  const { api, base, file, id } = await fixture(t);
  assert.equal((await fetch(base + '/api/devices')).status, 401);
  const list = await (await api('/api/devices')).text();
  assert.ok(list.includes('Spark')); assert.ok(!list.includes('remote-secret'));
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  await fs.writeFile(file, JSON.stringify([{ ...JSON.parse(await fs.readFile(file, 'utf8'))[0], token: 'legacy-secret' }]));
  const reloaded = createDevices({ file }); reloaded.dispose();
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8'))[0].token, undefined);
  const saved = JSON.parse(await fs.readFile(file, 'utf8'))[0];
  assert.equal((await api(`/api/devices/${id}`, { method: 'PUT', body: JSON.stringify({ name: 'DGX Spark', url: saved.url }) })).status, 200);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8'))[0].token, undefined);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8'))[0].id, id);
  for (const url of ['file:///etc/passwd', 'http://user:pass@host', 'https://host?token=secret', 'http://host/api', 'http://host/#hash']) assert.throws(() => validateDevice({ name: 'Spark', url }));
  assert.equal((await api(`/api/devices/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/api/devices/${id}/proxy/api/state`)).status, 404);
});

test('REST relay drops legacy tokens and browser identity, strips cookies, preserves JSON, uploads and file ranges', async t => {
  const { api, id } = await fixture(t);
  const prefix = `/api/devices/${id}/proxy`;
  const result = await (await api(prefix + '/api/action?token=gateway-secret', { method: 'POST', headers: { cookie: 'private-cookie' }, body: JSON.stringify({ action: 'sendKeys', params: { target: '%1', keys: ['日本語'] } }) })).json();
  assert.equal(result.url, '/api/action'); assert.equal(result.cookie, null);
  assert.equal(JSON.parse(result.body).params.keys[0], '日本語');
  const upload = await (await api(prefix + '/api/files/upload?pane=%251', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('raw\0bytes') })).json();
  assert.equal(upload.body, 'raw\0bytes');
  const file = await api(prefix + '/files/content?ticket=signed', { headers: { range: 'bytes=1-3' } });
  assert.equal(file.status, 206); assert.equal(file.headers.get('content-range'), 'bytes 1-3/5'); assert.equal(await file.text(), 'bcd');
  for (const route of ['/api/devices', '/api/approvals/answer', '/api/devices/evil/proxy/api/state']) assert.equal((await api(prefix + route)).status, 404);
});

test('WebSocket relay preserves queued terminal input and binary frames, then closes on removal', async t => {
  const { api, base, id } = await fixture(t);
  const ws = new WebSocket(base.replace('http:', 'ws:') + `/ws/devices/${id}/terminal?session=$1`, { headers: identityHeaders });
  await once(ws, 'open');
  const reply = once(ws, 'message'); ws.send(JSON.stringify({ type: 'input', data: 'こんにちは' }));
  const [text, binary] = await reply; assert.equal(binary, false); assert.match(text.toString(), /こんにちは/);
  const bytes = once(ws, 'message'); ws.send(Buffer.from([0, 255, 1]));
  const [data, isBinary] = await bytes; assert.equal(isBinary, true); assert.deepEqual(data, Buffer.from([0, 255, 1]));
  const closed = once(ws, 'close'); await api(`/api/devices/${id}`, { method: 'DELETE' }); await closed;
});

test('offline upstream produces a bounded gateway error', async t => {
  const { api, id, upstream } = await fixture(t);
  await new Promise(resolve => upstream.close(resolve));
  const result = await api(`/api/devices/${id}/proxy/api/state`);
  assert.equal(result.status, 502); assert.match((await result.json()).error, /接続できません/);
});
