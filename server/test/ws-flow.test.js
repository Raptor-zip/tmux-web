import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createWebSocketForwarder } from '../src/ws-flow.js';

function fixture() {
  const callbacks = [], messages = [];
  let paused = false, errors = 0;
  const from = { readyState: WebSocket.OPEN, pause() { paused = true; }, resume() { paused = false; } };
  const to = { readyState: WebSocket.OPEN, bufferedAmount: 0, send(data, options, cb) { messages.push([data, options]); callbacks.push(cb); } };
  return { from, to, callbacks, messages, send: createWebSocketForwarder(from, to, () => errors++, 1024), get paused() { return paused; }, get errors() { return errors; } };
}

test('slow relay receiver pauses producer until every write finishes, preserving bytes and message types', () => {
  const f = fixture();
  const bytes = Buffer.from([0, 255, 123]);
  f.send(bytes, true);
  f.send(Buffer.from('input'), false);
  assert.equal(f.paused, true);
  assert.deepEqual(f.messages, [[bytes, { binary: true }], [Buffer.from('input'), { binary: false }]]);
  f.callbacks[0]();
  assert.equal(f.paused, true);
  f.callbacks[1]();
  assert.equal(f.paused, false);
  assert.equal(f.errors, 0);
});

test('relay bounds queued bytes including the next message, and handles send failure', () => {
  const f = fixture();
  f.to.bufferedAmount = 1020;
  f.send(Buffer.alloc(5), true);
  assert.equal(f.errors, 1);
  assert.equal(f.messages.length, 0);
  f.to.bufferedAmount = 0;
  f.send(Buffer.alloc(1), true);
  f.callbacks[0](new Error('disconnected'));
  assert.equal(f.errors, 2);
  assert.equal(f.paused, true);
});

test('relay does not resume closed producers or write to closed destinations', () => {
  const f = fixture();
  f.send(Buffer.alloc(1), true);
  f.from.readyState = WebSocket.CLOSED;
  f.callbacks[0]();
  assert.equal(f.paused, true);
  f.to.readyState = WebSocket.CLOSED;
  f.send(Buffer.alloc(1), true);
  assert.equal(f.messages.length, 1);
});
