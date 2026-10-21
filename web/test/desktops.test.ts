import test from 'node:test';
import assert from 'node:assert/strict';
import { addDesktop, desktopKey, INITIAL_DESKTOPS, removeDesktop, restoreDesktops } from '../src/desktops';

test('legacy terminal layout stays on the first desktop and new desktops use independent keys', () => {
  assert.equal(desktopKey('main', 'tw.layout'), 'tw.layout');
  assert.equal(desktopKey('second', 'tw.layout'), 'tw.layout.second');
  assert.equal(desktopKey('second', 'tw.serverPid'), 'tw.serverPid.second');
  const next = addDesktop(INITIAL_DESKTOPS, 'second');
  assert.equal(next.activeId, 'second'); assert.equal(next.items.length, 2);
  assert.deepEqual(INITIAL_DESKTOPS.items, [{ id: 'main', name: 'デスクトップ1' }]);
  assert.equal(addDesktop(next, 'second'), next);
});

test('removing a desktop selects a neighbour, retains other names and never removes the last desktop', () => {
  const state = addDesktop(addDesktop(INITIAL_DESKTOPS, 'second'), 'third');
  const next = removeDesktop(state, 'third');
  assert.equal(next.activeId, 'second'); assert.equal(next.items.length, 2);
  assert.equal(removeDesktop(next, 'main').activeId, 'second');
  assert.equal(removeDesktop(INITIAL_DESKTOPS, 'main'), INITIAL_DESKTOPS);
  assert.equal(removeDesktop(next, 'unknown'), next);
});

test('invalid storage recovers and active desktop survives a reload', () => {
  for (const raw of [null, [], {}, {items: []}, {items: [{id:'../bad',name:'bad'}]}]) assert.deepEqual(restoreDesktops(raw), INITIAL_DESKTOPS);
  const state = { activeId: 'second', items: [{ id: 'main', name: 'PC' }, { id: 'second', name: 'Spark' }] };
  assert.deepEqual(restoreDesktops(JSON.parse(JSON.stringify(state))), state);
  assert.equal(restoreDesktops({...state, activeId:'missing'}).activeId,'main');
  assert.equal(restoreDesktops({items:[...state.items,state.items[0]]}).items.length,2);
});
