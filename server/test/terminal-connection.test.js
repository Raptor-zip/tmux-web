import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { connectTerminal } from '../src/terminal.js';

function fixture() {
  const ws = new EventEmitter();
  ws.OPEN = ws.readyState = 1;
  ws.sent = [];
  ws.send = data => { assert.equal(ws.readyState, ws.OPEN); ws.sent.push(data); };
  ws.close = () => { ws.readyState = 3; ws.emit('close'); };
  const writes = [];
  let disposed = 0;
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const attachment = { dispose: async () => { disposed++; }, pty: {
    write: data => writes.push(data), resize() {}, onData() {}, onExit() {},
  } };
  const connection = connectTerminal(ws, { url: '/ws/terminal?session=%240' }, () => {}, () => pending);
  return { ws, writes, connection, ready: () => resolve(attachment), disposed: () => disposed };
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
