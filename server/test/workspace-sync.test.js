import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createWorkspaceSync } from '../src/workspace-sync.js';
import { auth, headers } from './helpers/tailscale.js';

const desktops = JSON.stringify({ activeId: 'main', items: [{ id: 'main', name: 'Main' }, { id: 'second', name: 'Second' }] });
const layout = id => JSON.stringify({ type: 'leaf', id: `leaf-${id}`, activeId: `tab-${id}`, tabs: [{ id: `tab-${id}`, sessionId: '$1', windowId: `@${id}` }] });
const patch = (id, changes, seed = false) => JSON.stringify({ type: 'workspace-patch', id, changes, seed });
const change = (before, after) => ({ before, after });

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-workspace-'));
  const file = path.join(dir, 'workspace.json');
  let sync = createWorkspaceSync({ file });
  const authentication = auth();
  const server = http.createServer();
  server.on('upgrade', (req, socket, head) => {
    if (authentication.authorize(req).status !== 200) return socket.destroy();
    sync.upgrade(req, socket, head);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const sockets = [];
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    sync.dispose();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const connect = async (identity = headers) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws/workspace`, { headers: identity });
    sockets.push(ws);
    const messages = [];
    const waiters = [];
    ws.on('message', raw => {
      const value = JSON.parse(raw.toString());
      if (waiters.length) waiters.shift()(value); else messages.push(value);
    });
    await once(ws, 'open');
    const next = () => messages.length ? Promise.resolve(messages.shift()) : new Promise(resolve => waiters.push(resolve));
    return { ws, next, initial: await next(), send: data => ws.send(data) };
  };
  return { connect, file, restart() { sync.dispose(); sync = createWorkspaceSync({ file }); } };
}

test('authenticated clients seed once, receive live changes, and restore them after restart', async t => {
  const f = await fixture(t);
  const a = await f.connect(); const b = await f.connect();
  assert.equal(a.initial.initialized, false);
  a.send(patch('seed', { 'tw.desktops': change(null, desktops), 'tw.layout': change(null, layout(1)) }, true));
  assert.equal((await a.next()).ack, 'seed');
  assert.equal((await b.next()).values['tw.layout'], layout(1));
  b.send(patch('seed-again', { 'tw.desktops': change(null, desktops) }, true));
  assert.equal((await b.next()).conflict, true);
  a.send(patch('edit', { 'tw.layout': change(layout(1), layout(2)), 'tw.focusedLeaf': change(null, '"leaf-2"') }));
  assert.equal((await a.next()).revision, 2);
  const received = await b.next();
  assert.equal(received.values['tw.layout'], layout(2));
  assert.equal(received.values['tw.focusedLeaf'], '"leaf-2"');
  assert.equal((await fs.stat(f.file)).mode & 0o777, 0o600);
  f.restart();
  const c = await f.connect();
  assert.deepEqual(c.initial.values, received.values);
});

test('concurrent changes to separate desktops survive; stale cross-desktop moves fail atomically', async t => {
  const f = await fixture(t); const a = await f.connect(); const b = await f.connect();
  a.send(patch('seed', { 'tw.desktops': change(null, desktops), 'tw.layout': change(null, layout(1)) }, true));
  await a.next(); await b.next();
  a.send(patch('a', { 'tw.layout': change(layout(1), layout(2)) }));
  b.send(patch('b', { 'tw.layout.second': change(null, layout(3)) }));
  for (const client of [a, b]) { await client.next(); await client.next(); }
  b.send(patch('move', { 'tw.layout': change(layout(1), 'null'), 'tw.layout.second': change(layout(3), layout(1)) }));
  const conflict = await b.next();
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.values['tw.layout'], layout(2));
  assert.equal(conflict.values['tw.layout.second'], layout(3));
  b.send(patch('move-fresh', { 'tw.layout': change(layout(2), 'null'), 'tw.layout.second': change(layout(3), layout(2)) }));
  assert.equal((await b.next()).values['tw.layout'], 'null');
  const update = await a.next();
  assert.equal(update.values['tw.layout.second'], layout(2));
});

test('invalid payloads cannot change settings or write invalid trees; deleting desktops removes their saved keys', async t => {
  const f = await fixture(t); const a = await f.connect();
  a.send(patch('seed', { 'tw.desktops': change(null, desktops), 'tw.layout.second': change(null, layout(1)) }, true)); await a.next();
  for (const changes of [
    { 'tw.fontSize': change(null, '15') },
    { '__proto__': change(null, '{}') },
    { 'tw.layout': change(null, '{"type":"split"}') },
    { 'tw.desktops': change(desktops, 'null') },
    { 'tw.layout': change(null, JSON.stringify({ ...JSON.parse(layout(2)), activeId: 'missing' })) },
  ]) {
    a.send(patch('bad', changes));
    const reply = await a.next();
    assert.ok(reply.error); assert.equal(reply.revision, 1);
  }
  const remaining = JSON.stringify({ activeId: 'main', items: [{ id: 'main', name: 'Main' }] });
  a.send(patch('remove', { 'tw.desktops': change(desktops, remaining) }));
  assert.equal((await a.next()).values['tw.layout.second'], undefined);
  a.send(JSON.stringify({ type: 'refresh' }));
  assert.equal((await a.next()).revision, 2);
});

test('the upgrade requires the existing Tailscale authorization', async t => {
  const f = await fixture(t);
  await assert.rejects(f.connect({}));
});
