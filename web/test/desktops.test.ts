import test from 'node:test';
import assert from 'node:assert/strict';
import { addDesktop, desktopKey, INITIAL_DESKTOPS, removeDesktop, restoreDesktops, transferDesktopTab } from '../src/desktops';

import { allLeaves, allTabs, makeLeaf, makeTab, splitWithTab } from '../src/layout';

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

test('moving the last tab to an empty desktop preserves its identity and restoration metadata', () => {
  const tab = { ...makeTab('spark~$1', 'spark~@1'), sessionName: 'work', windowName: 'agent', windowIndex: 2 };
  const source = makeLeaf(tab);
  const result = transferDesktopTab(source, null, tab.id, null)!;
  assert.equal(result.source, null);
  assert.deepEqual(allTabs(result.destination).map(item => item.tab), [tab]);
  assert.equal(result.focusedId, result.destination.id);
  assert.deepEqual(allTabs(source).map(item => item.tab), [tab]);
});

test('desktop transfer appends to the focused panel and collapses an emptied source panel', () => {
  const tab = makeTab('$1', '@1');
  const other = makeLeaf(makeTab('$1', '@2'));
  const source = splitWithTab(other, other.id, 'right', tab).tree;
  const destinationBase = makeLeaf(makeTab('$1', '@3'));
  const destination = splitWithTab(destinationBase, destinationBase.id, 'bottom', makeTab('$1', '@4'));
  const result = transferDesktopTab(source, destination.tree, tab.id, destination.leafId)!;
  assert.deepEqual(result.source, other);
  assert.equal(result.focusedId, destination.leafId);
  const panel = allLeaves(result.destination).find(leaf => leaf.id === destination.leafId)!;
  assert.equal(panel.tabs.at(-1)?.id, tab.id);
  assert.equal(panel.activeId, tab.id);
  assert.equal(allLeaves(result.destination).length, 2);
});

test('an already open destination window is activated without duplication', () => {
  const tab = makeTab('$1', '@1');
  const existing = makeTab('$1', '@1');
  const destination = makeLeaf(existing);
  const result = transferDesktopTab(makeLeaf(tab), destination, tab.id, 'missing')!;
  assert.equal(result.source, null);
  assert.equal(result.focusedId, destination.id);
  assert.deepEqual(allTabs(result.destination).map(item => item.tab.id), [existing.id]);
  assert.equal(transferDesktopTab(makeLeaf(tab), destination, 'missing', null), null);
});
