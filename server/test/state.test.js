import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleState, stateSignature } from '../src/state.js';

test('mirrors and grouped views do not multiply visible panes', () => {
  const sessions = [
    { id: '$0', name: 'work', group: 'work', groupSize: 3, created: 1 },
    { id: '$1', name: 'other-view', group: 'work', groupSize: 3, created: 2 },
    { id: '$2', name: 'webmux-123-1', group: 'work', groupSize: 3, created: 3 },
    { id: '$3', name: 'independent', group: null },
  ];
  const windows = sessions.map(s => ({ id: s.id === '$3' ? '@1' : '@0', sessionId: s.id }));
  const panes = windows.flatMap(w => [0, 1].map(i => ({ id: `${w.id}-${i}`, windowId: w.id, sessionId: w.sessionId })));
  const state = visibleState({ sessions, windows, panes, ts: 100 });
  assert.deepEqual(state.sessions.map(s => s.id), ['$0', '$3']);
  assert.equal(state.windows.length, 2);
  assert.equal(state.panes.length, 4);
  assert.equal(new Set(state.panes.map(p => p.id)).size, 4);
});

test('poll timestamps do not trigger a state broadcast, actual changes do', () => {
  const state = { sessions: [], windows: [], panes: [], serverPid: 42, ts: 100 };
  assert.equal(stateSignature(state), stateSignature({ ...state, ts: 200 }));
  assert.notEqual(stateSignature(state), stateSignature({ ...state, serverPid: 43 }));
  assert.notEqual(stateSignature(state), stateSignature({ ...state, panes: [{ id: '%1', title: 'changed' }] }));
});
