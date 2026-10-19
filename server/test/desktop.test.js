import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';
import { createDesktop } from '../src/desktop.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 150; i++) { if (await check()) return; await delay(20); }
  throw new Error('timed out');
}
async function fixture(t, options = {}) {
  let spawns = 0, kills = 0, args, socketPath, peer;
  const vnc = net.createServer(socket => { peer = socket; socket.on('error', () => {}); socket.write('RFB 003.008\n'); });
  const desktop = createDesktop({
    probe: async () => ({ display: ':99', width: 640, height: 480, env: {} }),
    spawnVnc: (_cmd, argv) => {
      spawns++; args = argv;
      socketPath = argv[argv.indexOf('-unixsock') + 1];
      vnc.listen(socketPath);
      const proc = new EventEmitter(); proc.stderr = new PassThrough(); proc.exitCode = null;
      proc.kill = () => { kills++; peer?.destroy(); vnc.close(); proc.exitCode = 0; queueMicrotask(() => proc.emit('close', 0)); return true; };
      return proc;
    },
    ...options,
  });
  const server = http.createServer();
  // Same authentication boundary as index.js: reject before upgrading/spawning.
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://localhost').searchParams.get('token') !== 'qa') {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return;
    }
    desktop.upgrade(req, socket, head);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { desktop.dispose(); server.close(); vnc.close(); });
  return { desktop, url: `ws://127.0.0.1:${server.address().port}/ws/desktop`, get spawns() { return spawns; }, get kills() { return kills; }, get args() { return args; }, get socketPath() { return socketPath; }, get peer() { return peer; } };
}

test('desktop is authenticated, bridges binary traffic, uses a private socket, and cleans up on disconnect', async t => {
  const f = await fixture(t);
  const denied = new WebSocket(f.url);
  const [err] = await once(denied, 'error');
  assert.match(err.message, /401/); assert.equal(f.spawns, 0);
  const ws = new WebSocket(f.url + '?token=qa');
  const [greeting, binary] = await once(ws, 'message');
  assert.equal(greeting.toString(), 'RFB 003.008\n'); assert.equal(binary, true);
  assert.equal((await stat(path.dirname(f.socketPath))).mode & 0o777, 0o700);
  assert.equal(f.args[f.args.indexOf('-rfbport') + 1], '0');
  assert.ok(f.args.includes('-no6')); assert.ok(f.args.includes('-safer')); assert.ok(f.args.includes('-norc'));
  const response = once(f.peer, 'data'); ws.send(Buffer.from([0, 1, 254, 255]));
  assert.deepEqual((await response)[0], Buffer.from([0, 1, 254, 255]));
  assert.equal((await f.desktop.status()).viewers, 1);
  ws.close(); await once(ws, 'close');
  await until(async () => (await f.desktop.status()).viewers === 0);
  await until(async () => { try { await stat(path.dirname(f.socketPath)); return false; } catch { return true; } });
  assert.equal(f.kills, 1);
});

test('unavailable desktop returns a useful status and closes without spawning', async t => {
  const f = await fixture(t, { probe: async () => { throw new Error('X11 unavailable'); } });
  assert.deepEqual(await f.desktop.status(), { available: false, error: 'X11 unavailable', viewers: 0 });
  const ws = new WebSocket(f.url + '?token=qa');
  const [code, reason] = await once(ws, 'close');
  assert.equal(code, 1011); assert.match(reason.toString(), /X11 unavailable/); assert.equal(f.spawns, 0);
});

test('closing during probe cancels startup and disposal ends active sessions', async t => {
  let release;
  const f = await fixture(t, { probe: () => new Promise(resolve => { release = resolve; }) });
  const ws = new WebSocket(f.url + '?token=qa'); await once(ws, 'open');
  await until(() => release);
  ws.close(); await once(ws, 'close');
  release({ display: ':99', env: {} }); await delay(30);
  assert.equal(f.spawns, 0);
  f.desktop.dispose();
});

test('server disposal stops a connected desktop process', async t => {
  const f = await fixture(t);
  const ws = new WebSocket(f.url + '?token=qa'); await once(ws, 'message');
  const closed = once(ws, 'close'); f.desktop.dispose(); await closed;
  assert.equal(f.kills, 1);
});
