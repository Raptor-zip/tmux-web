import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceStore, isWorkspaceKey } from '../src/workspace-sync';

class FakeSocket {
  OPEN = 1; readyState = 1;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  message(values: Record<string, string>, extra = {}) { this.onmessage?.({ data: JSON.stringify({ type: 'workspace', initialized: true, revision: 1, values, ...extra }) } as MessageEvent); }
  close() { this.readyState = 3; this.onclose?.(); }
}
const desktops = JSON.stringify({ activeId: 'main', items: [{ id: 'main', name: 'Main' }] });
const snapshot = { 'tw.desktops': desktops, 'tw.layout': 'null' };
const tick = async () => { await Promise.resolve(); };
function fixture(t: TestContext, cached: Record<string, string> = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cache = new Map(Object.entries(cached));
  const storage = { get length() { return cache.size; }, key: (index: number) => [...cache.keys()][index], getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => cache.set(key, value), removeItem: (key: string) => cache.delete(key) } as Storage;
  const sockets: FakeSocket[] = [];
  const store = createWorkspaceStore({ storage, open() { const ws = new FakeSocket(); sockets.push(ws); return ws as unknown as WebSocket; } });
  store.start(); t.after(() => store.stop());
  return { store, sockets, cache, ws: sockets[0] };
}

test('initial hydration replaces stale browser cache without echoing it to the server', t => {
  const f = fixture(t, { 'tw.layout': '"stale"', 'tw.layout.deleted': 'null', 'tw.fontSize': '19' });
  assert.equal(f.store.getStatus().ready, false);
  f.ws.message(snapshot);
  assert.equal(f.store.get('tw.layout'), 'null');
  assert.equal(f.store.get('tw.layout.deleted'), null);
  assert.equal(f.cache.get('tw.fontSize'), '19');
  assert.equal(f.ws.sent.length, 0);
  assert.equal(f.store.getStatus().ready, true);
});

test('only the first browser seeds the server, including its unvisited desktop layouts', t => {
  const f = fixture(t, { ...snapshot, 'tw.layout.other': 'null', 'tw.mode': '"mirror"' });
  f.ws.message({}, { initialized: false, revision: 0 });
  const patch = f.ws.sent[0];
  assert.equal(patch.seed, true);
  assert.equal(patch.changes['tw.layout.other'].after, 'null');
  assert.equal(patch.changes['tw.mode'], undefined);
  assert.equal(f.store.getStatus().ready, false);
  f.ws.message(snapshot, { ack: patch.id });
  assert.equal(f.store.getStatus().ready, true);
});

test('a desktop transfer and selection are sent as one atomic patch and never echo received updates', async t => {
  const f = fixture(t); f.ws.message(snapshot);
  f.store.set('tw.layout', '"source"');
  f.store.set('tw.layout.other', '"destination"');
  f.store.set('tw.desktops', '"selection"');
  assert.equal(f.ws.sent.length, 0);
  await tick();
  const patch = f.ws.sent[0];
  assert.equal(Object.keys(patch.changes).length, 3);
  const values = { 'tw.desktops': '"selection"', 'tw.layout': '"source"', 'tw.layout.other': '"destination"' };
  f.ws.message(values, { ack: patch.id });
  await tick();
  assert.equal(f.ws.sent.length, 1);
  f.ws.message({ ...values, 'tw.focusedLeaf': '"new-focus"' }, { revision: 2 });
  assert.equal(f.store.get('tw.focusedLeaf'), '"new-focus"');
  assert.equal(f.ws.sent.length, 1);
});

test('rapid edits retain their original baseline, and a local round trip produces no patch', async t => {
  const f = fixture(t); f.ws.message(snapshot);
  f.store.set('tw.focusedLeaf', '"a"'); f.store.set('tw.focusedLeaf', '"b"');
  await tick();
  assert.deepEqual(f.ws.sent[0].changes['tw.focusedLeaf'], { before: null, after: '"b"' });
  f.ws.message({ ...snapshot, 'tw.focusedLeaf': '"b"' }, { ack: f.ws.sent[0].id });
  f.store.set('tw.layout', '"temp"'); f.store.set('tw.layout', 'null'); await tick();
  assert.equal(f.ws.sent.length, 1);
});

test('queued edits survive acknowledgements and unrelated remote updates', async t => {
  const f = fixture(t); f.ws.message(snapshot);
  f.store.set('tw.layout', '"first"'); await tick();
  const first = f.ws.sent[0];
  f.store.set('tw.layout', '"second"'); await tick();
  assert.equal(f.ws.sent.length, 1);
  f.ws.message({ ...snapshot, 'tw.device': '"remote"' }, { revision: 2 });
  assert.equal(f.store.get('tw.layout'), '"second"');
  f.ws.message({ ...snapshot, 'tw.device': '"remote"', 'tw.layout': '"first"' }, { revision: 3, ack: first.id });
  assert.equal(f.ws.sent.length, 2);
  assert.deepEqual(f.ws.sent[1].changes['tw.layout'], { before: '"first"', after: '"second"' });
});

test('reconnect drops stale offline edits atomically while retaining unrelated changes', async t => {
  const f = fixture(t); f.ws.message(snapshot); f.ws.close();
  f.store.set('tw.layout', '"local"'); f.store.set('tw.layout.other', '"move"'); await tick();
  f.store.set('tw.device', '"remote-device"'); await tick();
  t.mock.timers.tick(2500);
  f.sockets[1].message({ ...snapshot, 'tw.layout': '"newer-server-layout"' }, { revision: 4 });
  assert.equal(f.store.get('tw.layout'), '"newer-server-layout"');
  assert.equal(f.store.get('tw.layout.other'), null);
  assert.equal(f.store.get('tw.device'), '"remote-device"');
  assert.deepEqual(Object.keys(f.sockets[1].sent[0].changes), ['tw.device']);
  assert.match(f.store.getStatus().error, /同時変更/);
});

test('lost acknowledgements are recognized on reconnect without replaying an already applied edit', async t => {
  const f = fixture(t); f.ws.message(snapshot);
  f.store.set('tw.layout', '"first"'); await tick(); f.ws.close();
  f.store.set('tw.layout', '"second"'); await tick();
  t.mock.timers.tick(2500);
  f.sockets[1].message({ ...snapshot, 'tw.layout': '"first"' }, { revision: 2 });
  assert.equal(f.store.get('tw.layout'), '"second"');
  assert.deepEqual(f.sockets[1].sent[0].changes['tw.layout'], { before: '"first"', after: '"second"' });
});

test('silent connections retry and disposal prevents reconnects and late writes', async t => {
  const f = fixture(t); f.ws.message(snapshot);
  t.mock.timers.tick(30000); assert.equal(f.ws.sent[0].type, 'refresh');
  t.mock.timers.tick(10000); assert.equal(f.store.getStatus().connected, false);
  t.mock.timers.tick(2500); assert.equal(f.sockets.length, 2);
  f.store.stop(); t.mock.timers.tick(120000);
  assert.equal(f.sockets.length, 2);
  assert.equal(f.sockets[1].onmessage, null);
});

test('shared keys exclude unrelated browser preferences', () => {
  for (const key of ['tw.desktops', 'tw.layout', 'tw.layout.second', 'tw.serverPid.second', 'tw.device', 'tw.focusedLeaf']) assert.ok(isWorkspaceKey(key));
  for (const key of ['tw.fontSize', 'tw.mode', 'tw.desktops.other', '__proto__', 'tw.layout../bad']) assert.equal(isWorkspaceKey(key), false);
});
