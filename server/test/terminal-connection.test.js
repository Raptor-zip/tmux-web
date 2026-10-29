import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { connectTerminal, TERMINAL_MAX_PAYLOAD } from '../src/terminal.js';

function fixture(options = {}) {
  const ws = new EventEmitter();
  ws.OPEN = ws.readyState = 1;
  ws.bufferedAmount = 0;
  ws.sent = [];
  ws.send = data => { assert.equal(ws.readyState, ws.OPEN); ws.sent.push(data); };
  ws.close = code => { ws.closeCode = code; ws.readyState = 3; ws.emit('close'); };
  const writes = [];
  const resizes = [];
  const selections = [];
  let disposed = 0;
  let resolve, reject, args, dataListener, exitListener;
  const pending = new Promise((done, fail) => { resolve = done; reject = fail; });
  const attachment = { dispose: async () => { disposed++; await options.dispose?.(); },
    selectWindowIndex: index => { selections.push(index); return options.select?.(index); }, pty: {
    write: data => { options.write?.(data); writes.push(data); },
    resize: (cols, rows) => { options.resize?.(cols, rows); resizes.push([cols, rows]); },
    onData(listener) { dataListener = listener; if (options.initialOutput !== false) queueMicrotask(() => { if (dataListener === listener) listener('initial screen'); }); return { dispose() { dataListener = null; } }; },
    onExit(listener) { exitListener = listener; return { dispose() { exitListener = null; } }; },
  } };
  const connection = connectTerminal(ws, { url: options.url || '/ws/terminal?session=%240' }, () => {}, params => { args = params; return pending; });
  return { ws, writes, resizes, selections, connection, ready: () => resolve(attachment), fail: reject,
    disposed: () => disposed, args: () => args,
    send: message => ws.emit('message', Buffer.from(JSON.stringify(message)), false),
    binary: data => ws.emit('message', data, true),
    output: data => dataListener?.(data), exit: code => exitListener?.({ exitCode: code }),
  };
}

test('closing while attach is pending disposes the late attachment without sending or replaying input', async () => {
  const f = fixture();
  f.ws.emit('message', Buffer.from('{"type":"input","data":"queued"}'), false);
  f.ws.close();
  f.ready();
  await f.connection;
  assert.equal(f.disposed(), 1);
  assert.deepEqual(f.ws.sent, []);
  assert.deepEqual(f.writes, []);
});

test('ready connections replay input and dispose only once on error followed by close', async () => {
  const f = fixture();
  f.ws.emit('message', Buffer.from('{"type":"input","data":"queued"}'), false);
  f.ready();
  await f.connection;
  assert.equal(JSON.parse(f.ws.sent[0]).type, 'ready');
  assert.deepEqual(f.writes, ['queued']);
  f.ws.emit('error', new Error('disconnected'));
  f.ws.close();
  assert.equal(f.disposed(), 1);
});

test('malformed messages received during attachment never reject the connection or reach the PTY', async () => {
  const f = fixture();
  for (const message of [null, [], 'input', { type: 'input', data: null }, { type: 'resize', cols: 'bad', rows: -1 }]) {
    f.ws.emit('message', Buffer.from(JSON.stringify(message)), false);
  }
  f.ws.emit('message', Buffer.from('{"type":"input","data":"valid"}'), false);
  f.ready();
  await f.connection;
  assert.deepEqual(f.writes, ['valid']);
  f.ws.close();
});

test('the ready frame and queued input wait for the PTY to produce its initial output', async () => {
  const f = fixture({ initialOutput: false });
  f.send({ type: 'input', data: 'queued-before-attach' });
  f.ready(); await f.connection;
  f.send({ type: 'input', data: 'queued-before-output' });
  assert.deepEqual(f.ws.sent, []);
  assert.deepEqual(f.writes, []);
  f.output('initial screen');
  assert.equal(JSON.parse(f.ws.sent[0]).type, 'ready');
  assert.deepEqual(f.ws.sent[1], Buffer.from('initial screen'));
  assert.deepEqual(f.writes, ['queued-before-attach', 'queued-before-output']);
  f.ws.close();
});

test('input, resize and subsequent selections wait for a window switch to complete', async () => {
  let release;
  const switching = new Promise(resolve => { release = resolve; });
  const order = [];
  const f = fixture({
    select: async index => { order.push(`start-${index}`); if (index === 1) await switching; order.push(`selected-${index}`); },
    write: data => order.push(data), resize: () => order.push('resized'),
  });
  f.ready(); await f.connection;
  f.send({ type: 'selectWindow', index: 1 });
  f.send({ type: 'input', data: 'first' });
  f.send({ type: 'resize', cols: 120, rows: 30 });
  f.send({ type: 'selectWindow', index: 2 });
  f.binary(Buffer.from('日本語'));
  assert.deepEqual(f.writes, [], 'typing cannot reach the previously selected window');
  assert.deepEqual(order, ['start-1']);
  release(); await setImmediate();
  assert.deepEqual(order, ['start-1', 'selected-1', 'first', 'resized', 'start-2', 'selected-2', '日本語']);
  f.ws.close();
});

test('disconnecting during a window switch discards later queued input', async () => {
  let release;
  const switching = new Promise(resolve => { release = resolve; });
  const f = fixture({ select: () => switching });
  f.ready(); await f.connection;
  f.send({ type: 'selectWindow', index: 1 });
  f.send({ type: 'input', data: 'discarded' });
  f.ws.close(); release(); await setImmediate();
  assert.deepEqual(f.writes, []);
  assert.equal(f.disposed(), 1);
});

test('a failed asynchronous window switch closes only its connection without replaying input', async () => {
  const f = fixture({ select: async () => { throw new Error('tmux selection failed'); } });
  f.ready(); await f.connection;
  f.send({ type: 'selectWindow', index: 1 });
  f.send({ type: 'input', data: 'discarded' });
  await setImmediate();
  assert.equal(f.ws.readyState, 3);
  assert.equal(f.ws.closeCode, 1011);
  assert.deepEqual(f.writes, []);
  assert.equal(f.disposed(), 1);
});

test('PTY write and disposal failures never escape as unhandled rejections', async () => {
  const f = fixture({ write() { throw new Error('PTY already closed'); }, dispose: async () => { throw new Error('cleanup failed'); } });
  f.ready(); await f.connection;
  assert.doesNotThrow(() => f.send({ type: 'input', data: 'first' }));
  f.send({ type: 'input', data: 'discarded' });
  await setImmediate();
  assert.equal(f.ws.readyState, 3);
  assert.equal(f.disposed(), 1);
  assert.deepEqual(f.writes, []);
});

test('pending input has a byte limit and a late attachment is still released', async () => {
  const f = fixture();
  f.binary(Buffer.alloc(1024 * 1024, 'a'));
  f.binary(Buffer.from('あ'));
  assert.equal(f.ws.closeCode, 1009);
  f.ready(); await f.connection;
  assert.equal(f.disposed(), 1);
  assert.deepEqual(f.writes, []);
});

test('pending control messages have a count limit independently of their byte size', async () => {
  const f = fixture();
  for (let i = 0; i < 1025; i++) f.send({ type: 'resize', cols: 80, rows: 24 });
  assert.equal(f.ws.closeCode, 1009);
  f.ready(); await f.connection;
  assert.equal(f.disposed(), 1);
  assert.deepEqual(f.resizes, []);
});

test('invalid and extreme terminal dimensions cannot reach the native PTY unchecked', async () => {
  const invalid = fixture({ url: '/ws/terminal?session=%240&cols=NaN&rows=-10' });
  assert.equal(invalid.args().cols, 80); assert.equal(invalid.args().rows, 24);
  invalid.ready(); await invalid.connection;
  invalid.send({ type: 'resize', cols: '120', rows: 24 });
  invalid.send({ type: 'resize', cols: 0, rows: 24 });
  invalid.send({ type: 'selectWindow', index: '1' });
  assert.deepEqual(invalid.resizes, []); assert.deepEqual(invalid.selections, []);
  invalid.ws.close();
  const large = fixture({ url: '/ws/terminal?session=%240&cols=9999999&rows=9999999' });
  assert.equal(large.args().cols, 2000); assert.equal(large.args().rows, 1000);
  large.ready(); await large.connection;
  large.send({ type: 'resize', cols: 9999999, rows: 9999999 });
  assert.deepEqual(large.resizes, [[2000, 1000]]);
  large.ws.close();
});

test('a slow output consumer releases the PTY and stops accepting further output', async () => {
  const f = fixture();
  f.ready(); await f.connection;
  f.output('normal');
  assert.deepEqual(f.ws.sent.at(-1), Buffer.from('normal'));
  f.ws.bufferedAmount = TERMINAL_MAX_PAYLOAD + 1;
  f.output('too much');
  assert.equal(f.ws.closeCode, 1013);
  const count = f.ws.sent.length;
  f.output('discarded'); f.exit(0);
  assert.equal(f.ws.sent.length, count);
  assert.equal(f.disposed(), 1);
});

test('attachment and ready-send failures resolve the connection and release acquired resources', async () => {
  const unavailable = fixture();
  unavailable.fail(new Error('session missing'));
  await unavailable.connection;
  assert.equal(unavailable.ws.readyState, 3);
  assert.match(JSON.parse(unavailable.ws.sent[0]).message, /session missing/);
  const disconnected = fixture();
  disconnected.ws.send = () => { throw new Error('socket unavailable'); };
  disconnected.ready(); await disconnected.connection;
  assert.equal(disconnected.disposed(), 1);
  assert.equal(disconnected.ws.readyState, 3);
});
