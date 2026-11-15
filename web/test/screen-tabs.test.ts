import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeTab, addTab, allTabs, dedupeTabs, findByTarget, findScreenTab, isScreenTab, makeLeaf, makeScreenTab, makeTab,
  migrate, moveTab, pruneStale, remapByName, splitWithTab, stampNames, tabDevice, targetKey, type LayoutNode,
} from '../src/layout';
import { openScreenTab, transferDesktopTab } from '../src/desktops';
import { claimScreen, joinScreen, ownsScreen, releaseScreen, type ScreenLeaseEntry } from '../src/screen-lease';

const ids = (tree: LayoutNode | null) => (tree ? allTabs(tree).map(({ tab }) => tab.id) : []);

test('remote desktop tabs survive storage, sync revive and tmux reconciliation', () => {
  const terminal = makeTab('$1', '@1');
  const screen = makeScreenTab('spark');
  const tree = addTab(makeLeaf(terminal), (makeLeaf(terminal) as { id: string }).id, screen);
  const leaf = makeLeaf([terminal, screen]);
  const revived = migrate(JSON.parse(JSON.stringify({ ...leaf, activeId: screen.id })));
  assert.ok(revived && revived.type === 'leaf');
  assert.deepEqual(revived.tabs[1], { id: screen.id, kind: 'screen', deviceId: 'spark' });
  assert.equal(revived.activeId, screen.id, 'the selected screen tab stays selected after a reload');
  assert.ok(tree);

  // tmux に何も無くても、画面タブは消えない（端末タブだけが落ちる）
  assert.deepEqual(ids(pruneStale(leaf, new Set())), [screen.id]);
  const remapped = remapByName(leaf, { sessions: [], windows: [] });
  assert.deepEqual(ids(remapped), [screen.id]);
  assert.equal(remapped && allTabs(remapped)[0].tab, screen, 'remapping leaves the screen tab object untouched');
  const onlyScreens = makeLeaf(screen);
  assert.equal(stampNames(onlyScreens, { sessions: [{ id: '$1', name: 'dev' }], windows: [] }), onlyScreens);
});

test('migrate drops malformed and unknown tabs instead of treating them as terminals', () => {
  const tree = migrate({
    type: 'leaf', id: 'leaf', activeId: 'gone', tabs: [
      { id: 'a', kind: 'screen', deviceId: '../etc' },
      { id: 'b', kind: 'screen' },
      { id: 'c', kind: 'browser', sessionId: '$1', windowId: null },
      { id: 'd', kind: 'screen', deviceId: 'local', extra: 'dropped' },
      { id: 'e', sessionId: '$1', windowId: '@2' },
    ],
  });
  assert.ok(tree && tree.type === 'leaf');
  assert.deepEqual(tree.tabs, [{ id: 'd', kind: 'screen', deviceId: 'local' }, { id: 'e', sessionId: '$1', windowId: '@2' }]);
  assert.equal(tree.activeId, 'd');
});

test('screen tabs are keyed by device: one per device, never matching a terminal', () => {
  const local = makeScreenTab('local');
  const again = makeScreenTab('local');
  const spark = makeScreenTab('spark');
  const terminal = makeTab('$1', null);
  assert.equal(targetKey(local), 'screen:local');
  assert.notEqual(targetKey(spark), targetKey(local));
  assert.equal(tabDevice(spark), 'spark');
  assert.equal(tabDevice(makeTab('spark~$1', '@1')), 'spark');
  const tree = makeLeaf([terminal, local, spark, again]);
  assert.equal(findByTarget(tree, '$1', null)?.tab, terminal);
  assert.equal(findScreenTab(tree, 'spark')?.tab, spark);
  // 同じデバイスの画面は 1 枚に畳む。選んでいる方を残す
  assert.deepEqual(ids(dedupeTabs(tree, again.id)), [terminal.id, spark.id, again.id]);
  // 端末の null ウィンドウ同士は従来どおり畳まない
  const nulls = makeLeaf([makeTab('$1', null), makeTab('$1', null)]);
  assert.equal(dedupeTabs(nulls), nulls);
});

test('screen tabs split, move and transfer like terminal tabs without duplicating a device', () => {
  const terminal = makeTab('$1', '@1');
  const screen = makeScreenTab('local');
  const leaf = makeLeaf([terminal, screen]);
  const { tree, leafId } = splitWithTab(leaf, leaf.id, 'right', screen);
  assert.ok(allTabs(tree).some(({ leaf, tab }) => leaf.id === leafId && tab === screen));
  const moved = moveTab(leaf, screen.id, leaf.id, terminal.id);
  assert.ok(moved && moved.type === 'leaf' && moved.tabs[0] === screen);

  const destination = makeLeaf([makeTab('$2', '@5'), makeScreenTab('local')]);
  const result = transferDesktopTab(leaf, destination, screen.id, destination.id);
  assert.ok(result);
  assert.deepEqual(ids(result.source), [terminal.id]);
  const screens = allTabs(result.destination!).filter(({ tab }) => isScreenTab(tab));
  assert.equal(screens.length, 1, 'moving onto a desktop that already shows the device activates it');
  assert.equal(activeTab(result.destination as typeof destination)?.id, screens[0].tab.id);
});

test('opening a screen tab from the dialog reuses an existing tab for that device', () => {
  const created = openScreenTab(null, 'spark', null);
  assert.ok(created.layout.type === 'leaf');
  const screen = allTabs(created.layout)[0].tab;
  assert.ok(isScreenTab(screen) && screen.deviceId === 'spark');
  const withTerminal = addTab(created.layout, created.focusedId, makeTab('$1', '@1'));
  assert.ok(withTerminal);
  const again = openScreenTab(withTerminal, 'spark', created.focusedId);
  assert.equal(allTabs(again.layout).filter(({ tab }) => isScreenTab(tab)).length, 1);
  assert.equal(again.layout.type === 'leaf' && again.layout.activeId, screen.id);
  const other = openScreenTab(withTerminal, 'local', created.focusedId);
  assert.equal(allTabs(other.layout).filter(({ tab }) => isScreenTab(tab)).length, 2);
});

test('only one view per device holds the connection; releasing hands it to a visible waiter', () => {
  const entry = (wants: boolean) => {
    const e = { visible: wants, changes: 0, wants: () => e.visible, changed: () => { e.changes++; } };
    return e as ScreenLeaseEntry & { visible: boolean; changes: number };
  };
  const tab = entry(true), modal = entry(true), hidden = entry(false), other = entry(true);
  const leave = [joinScreen('dev', tab), joinScreen('dev', hidden), joinScreen('other', other)];
  const closeModal = joinScreen('dev', modal);
  claimScreen('dev', tab);
  claimScreen('other', other);
  assert.ok(ownsScreen('dev', tab));
  claimScreen('dev', modal);
  assert.ok(ownsScreen('dev', modal) && !ownsScreen('dev', tab), 'opening the dialog takes the connection from the tab');
  assert.ok(tab.changes > 0, 'the previous owner is told to disconnect');
  assert.ok(ownsScreen('other', other), 'other devices are unaffected');
  closeModal();
  assert.ok(ownsScreen('dev', tab), 'closing the dialog hands the connection back to the visible tab, not the hidden one');
  tab.visible = false;
  releaseScreen('dev', tab);
  assert.ok(!ownsScreen('dev', hidden) && !ownsScreen('dev', tab), 'nobody visible is waiting');
  leave.forEach(fn => fn());
  assert.ok(!ownsScreen('other', other), 'leaving releases the connection');
});
