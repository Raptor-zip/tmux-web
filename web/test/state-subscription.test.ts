import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { subscribeState, type StateRecord } from '../src/state-subscription';
import type { TmuxState } from '../src/types';

class FakeSocket {
  OPEN = 1;
  CONNECTING = 0;
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent) => unknown) | null = null;
  onclose: ((event: Event) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  send(data: string) { assert.equal(this.readyState, this.OPEN); this.sent.push(data); }
  open() { this.readyState = this.OPEN; this.onopen?.(new Event('open')); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent); }
  close() { this.readyState = 3; this.onclose?.(new Event('close')); }
}

const state = (ts: number): TmuxState => ({ ts, sessions: [], windows: [], panes: [], serverPid: 10 });
const stream = (ts: number) => ({ type: 'state', ...state(ts) });

function fixture(t: TestContext, disconnectOnError = false) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets: FakeSocket[] = [];
  const reads: { signal: AbortSignal; resolve(value: TmuxState): void; reject(reason: Error): void }[] = [];
  const updates: StateRecord[] = [];
  const errors: unknown[] = [];
  const subscription = subscribeState({
    open() { const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket; },
    read(signal) { return new Promise<TmuxState>((resolve, reject) => { reads.push({ signal, resolve, reject }); }); },
    update(value) { updates.push(value); },
    onError(error) { errors.push(error); if (disconnectOnError) return 'disconnect'; },
  });
  t.after(() => subscription.dispose());
  return { sockets, reads, updates, errors, subscription, last: () => updates.at(-1)! };
}

test('a delayed REST snapshot supplies metadata without rolling back newer streamed state', async t => {
  const f = fixture(t);
  f.sockets[0].open();
  f.sockets[0].message(stream(2));
  f.reads[0].resolve({ ...state(1), server: { version: 'tmux 3.4', prefix: 'C-b', socketName: 'default', home: '/home/demo' } });
  await setImmediate();
  assert.equal(f.last().state?.ts, 2);
  assert.equal(f.last().state?.server?.version, 'tmux 3.4');
  assert.equal(f.last().connected, true);
});

test('closed connections abort their request and ignore late completions while retaining the last snapshot', async t => {
  const f = fixture(t);
  f.sockets[0].open();
  f.sockets[0].message(stream(2));
  f.sockets[0].close();
  assert.equal(f.reads[0].signal.aborted, true);
  f.reads[0].resolve(state(1));
  await setImmediate();
  assert.equal(f.last().connected, false);
  assert.equal(f.last().state?.ts, 2);
  t.mock.timers.tick(2500);
  assert.equal(f.sockets.length, 2);
  assert.equal(f.last().connected, false);
  f.sockets[1].open();
  f.sockets[1].message(stream(3));
  assert.equal(f.last().connected, true);
  assert.equal(f.last().state?.ts, 3);
});

test('REST success does not mark a WebSocket that never opens as connected, and timeout retries it', async t => {
  const f = fixture(t);
  f.reads[0].resolve(state(1));
  await setImmediate();
  assert.equal(f.last().connected, false);
  t.mock.timers.tick(10000);
  assert.match(f.last().error!, /タイムアウト/);
  assert.equal(f.sockets[0].readyState, 3);
  t.mock.timers.tick(2500);
  assert.equal(f.sockets.length, 2);
});

test('a silent open stream is probed and reconnected when its refresh remains unanswered', async t => {
  const f = fixture(t);
  f.sockets[0].open();
  f.sockets[0].message(stream(1));
  const sent = f.sockets[0].sent.length;
  t.mock.timers.tick(30000);
  assert.equal(f.sockets[0].sent.length, sent + 1);
  t.mock.timers.tick(10000);
  assert.equal(f.last().connected, false);
  assert.match(f.last().error!, /応答がありません/);
  t.mock.timers.tick(2500);
  assert.equal(f.sockets.length, 2);
});

test('valid frames keep a quiet connection alive; malformed frames cannot satisfy its probe', async t => {
  const f = fixture(t);
  f.sockets[0].open();
  f.sockets[0].message(stream(1));
  t.mock.timers.tick(30000);
  f.sockets[0].message(stream(2));
  t.mock.timers.tick(10000);
  assert.equal(f.last().connected, true);
  t.mock.timers.tick(20000);
  f.sockets[0].message(null);
  f.sockets[0].message({ type: 'state', sessions: [] });
  t.mock.timers.tick(10000);
  assert.equal(f.last().connected, false);
});

test('a failed older REST request cannot disconnect a functioning state stream', async t => {
  const f = fixture(t);
  f.sockets[0].open();
  f.sockets[0].message(stream(2));
  f.reads[0].reject(new Error('HTTP timeout'));
  await setImmediate();
  assert.equal(f.last().connected, true);
  assert.equal(f.last().state?.ts, 2);
  assert.equal(f.errors.length, 1);
});

test('manual reconnect retires the old socket and disposal cancels every later retry', async t => {
  const f = fixture(t);
  f.sockets[0].open();
  f.subscription.reconnect();
  assert.equal(f.sockets.length, 2);
  assert.equal(f.sockets[0].readyState, 3);
  assert.equal(f.sockets[0].onmessage, null);
  assert.equal(f.reads[0].signal.aborted, true);
  f.subscription.dispose();
  assert.equal(f.reads[1].signal.aborted, true);
  const count = f.updates.length;
  f.reads[0].resolve(state(1));
  f.reads[1].resolve(state(2));
  await setImmediate();
  t.mock.timers.tick(120000);
  assert.equal(f.updates.length, count);
  assert.equal(f.sockets.length, 2);
});

test('an authentication failure retires an existing stream instead of treating its old authorization as current', async t => {
  const f = fixture(t, true);
  f.sockets[0].open();
  f.sockets[0].message(stream(2));
  f.reads[0].reject(new Error('本人確認が必要です'));
  await setImmediate();
  assert.equal(f.sockets[0].readyState, 3);
  assert.equal(f.last().connected, false);
  assert.match(f.last().error!, /本人確認/);
  assert.equal(f.last().state?.ts, 2);
});

test('manual refresh reconnects immediately during the retry delay', t => {
  const f = fixture(t);
  f.sockets[0].open();
  f.sockets[0].close();
  f.subscription.refresh();
  assert.equal(f.sockets.length, 2);
  t.mock.timers.tick(2500);
  assert.equal(f.sockets.length, 2, 'manual refresh cancels the scheduled retry');
});

test('repeated refresh clicks do not postpone recovery from an unanswered stream', t => {
  const f = fixture(t);
  f.sockets[0].open();
  f.sockets[0].message(stream(1));
  f.subscription.refresh();
  t.mock.timers.tick(5000);
  f.subscription.refresh();
  t.mock.timers.tick(5000);
  assert.equal(f.last().connected, false);
  assert.equal(f.sockets[0].readyState, 3);
});
