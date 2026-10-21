import { fetch } from './helpers/tailscale.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { createTailscaleAuth, assertLoopbackHost } from '../src/auth.js';

const identity = { hostname: 'pc.test.ts.net', owner: 'Owner@example.com' };
const headers = { host: 'pc.test.ts.net:8443', 'tailscale-user-login': 'owner@example.com', 'x-forwarded-proto': 'https' };
const request = (changes = {}, address = '127.0.0.1') => ({ socket: { remoteAddress: address }, headers: { ...headers, ...changes } });

test('Serve identity is required and only the owner or an explicit allowed user is admitted', () => {
  const auth = createTailscaleAuth({ identity });
  assert.equal(auth.authorize(request()).status, 200);
  assert.equal(auth.authorize(request({ 'tailscale-user-login': undefined })).status, 401);
  assert.equal(auth.authorize(request({ 'tailscale-user-login': 'stranger@example.com' })).status, 403);
  assert.equal(auth.authorize(request({ 'x-tmux-web-token': 'old-secret', 'tailscale-user-login': undefined })).status, 401);
  const explicit = createTailscaleAuth({ identity, users: 'admin@example.com, second@example.com' });
  assert.equal(explicit.authorize(request()).status, 403);
  assert.equal(explicit.authorize(request({ 'tailscale-user-login': 'second@example.com' })).status, 200);
});

test('forged identity from non-loopback, wrong Host, missing HTTPS and cross-origin browser requests are refused', () => {
  const auth = createTailscaleAuth({ identity });
  for (const address of ['100.64.0.2', '192.168.1.10', '::ffff:192.168.1.10', '127.0.0.2']) assert.equal(auth.authorize(request({}, address)).status, 403);
  for (const changes of [{ host: 'evil.example' }, { 'x-forwarded-proto': undefined }, { origin: 'https://evil.example' }, { origin: 'null' }, { origin: 'https://pc.test.ts.net:8444' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) assert.equal(auth.authorize(request(changes)).status, 403);
  assert.equal(auth.authorize(request({ origin: 'https://pc.test.ts.net:8443', 'sec-fetch-site': 'same-origin' })).status, 200);
  for (const host of ['0.0.0.0', '::', '100.64.0.1']) assert.throws(() => assertLoopbackHost(host));
  for (const host of ['localhost', '127.0.0.1', '::1']) assert.doesNotThrow(() => assertLoopbackHost(host));
});

test('unavailable Tailscale fails closed and recovers after discovery succeeds', async () => {
  let fail = true;
  const auth = createTailscaleAuth({ discover: async () => { if (fail) throw new Error('offline'); return identity; } });
  await auth.refresh(); assert.equal(auth.authorize(request()).status, 403);
  fail = false; await auth.refresh(); assert.equal(auth.authorize(request()).status, 200);
});

test('API, signed media and WebSocket all enforce the same identity and origin boundary', async t => {
  const auth = createTailscaleAuth({ identity });
  const app = express(); app.use(['/api', '/files'], auth.middleware);
  app.get('/api/state', (req, res) => res.json(req.auth));
  app.get('/files/content', (_req, res) => res.send('private media'));
  const server = http.createServer(app); const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const result = auth.authorize(req);
    if (result.status !== 200) return socket.end(`HTTP/1.1 ${result.status} Rejected\r\n\r\n`);
    wss.handleUpgrade(req, socket, head, ws => ws.send('authenticated'));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { for (const ws of wss.clients) ws.terminate(); wss.close(); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/api/state?token=old-secret', '/files/content?ticket=signed']) assert.equal((await fetch(base + path)).status, 401);
  assert.equal((await fetch(base + '/files/content?ticket=signed', { headers })).status, 200);
  assert.equal((await fetch(base + '/api/state', { headers: { ...headers, origin: 'https://evil.example' } })).status, 403);
  const denied = new WebSocket(base.replace('http:', 'ws:') + '/ws/terminal?token=old-secret');
  assert.match((await once(denied, 'error'))[0].message, /401/);
  const cross = new WebSocket(base.replace('http:', 'ws:') + '/ws/terminal', { headers: { ...headers, origin: 'https://evil.example' } });
  assert.match((await once(cross, 'error'))[0].message, /403/);
  const accepted = new WebSocket(base.replace('http:', 'ws:') + '/ws/terminal', { headers });
  assert.equal((await once(accepted, 'message'))[0].toString(), 'authenticated');
  accepted.close(); await once(accepted, 'close');
});
