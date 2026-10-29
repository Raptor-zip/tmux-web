import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalSelection } from '../src/terminal-selection';

test('updated servers require the latest matching selection acknowledgement', () => {
  const selection = new TerminalSelection();
  const request = selection.request(0, '@1');
  assert.equal(selection.canInput('@1'), false);
  selection.receiveReady(true, '@1');
  assert.equal(selection.phase, 'selecting');
  for (const [id, window] of [[request.requestId - 1, '@1'], [request.requestId, '@2'], [String(request.requestId), '@1']]) {
    assert.equal(selection.confirm(id, window), false);
    assert.equal(selection.canInput('@1'), false);
  }
  assert.equal(selection.confirm(request.requestId, '@1'), true);
  assert.equal(selection.canInput('@1'), true);
});

test('A to B to A cannot use the first A acknowledgement for the last request', () => {
  const selection = new TerminalSelection();
  selection.receiveReady(true, '@1');
  const first = selection.request(0, '@1');
  const middle = selection.request(1, '@2');
  const last = selection.request(0, '@1');
  for (const request of [first, middle]) {
    assert.equal(selection.confirm(request.requestId, request.windowId), false);
    assert.equal(selection.canInput('@1'), false);
  }
  assert.equal(selection.confirm(last.requestId, last.windowId), true);
  assert.equal(selection.canInput('@1'), true);
});

test('a changed render target cannot paste through the previously confirmed selection', () => {
  const selection = new TerminalSelection();
  selection.receiveReady(true, '@1');
  const first = selection.request(0, '@1'); selection.confirm(first.requestId, first.windowId);
  assert.equal(selection.canInput('@2'), false);
  const next = selection.request(1, '@2');
  assert.equal(selection.canInput('@1'), false);
  selection.confirm(next.requestId, next.windowId);
  assert.equal(selection.canInput('@2'), true);
});

test('legacy servers remain ready without new acknowledgement messages', () => {
  const selection = new TerminalSelection();
  selection.request(0, '@1');
  selection.receiveReady(false, null);
  assert.equal(selection.canInput('@1'), true);
  selection.request(1, '@2');
  assert.equal(selection.canInput('@2'), true);
});

test('session-only attachment readiness and duplicate ready messages retain their target boundary', () => {
  const selection = new TerminalSelection();
  selection.receiveReady(true, null);
  assert.equal(selection.canInput(null), true);
  assert.equal(selection.canInput('@1'), false);
  const request = selection.request(0, '@1');
  selection.receiveReady(false, '@1');
  assert.equal(selection.canInput('@1'), false, 'a second ready frame cannot remove the acknowledgement requirement');
  selection.confirm(request.requestId, request.windowId);
  assert.equal(selection.canInput('@1'), true);
});
