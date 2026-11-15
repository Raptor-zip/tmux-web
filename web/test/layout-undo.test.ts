import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allLeaves, allTabs, closeTabs, makeLeaf, makeTab, migrate, removeLeaf, sameLayout, snapshotLayout,
  splitWithTab, undoLayout, UNDO_MS, type LayoutNode,
} from '../src/layout';

function fixture() {
  const [a, b, c] = ['@1', '@2', '@3'].map((w) => makeTab('$1', w));
  const d = makeTab('$1', '@4');
  const left = makeLeaf([a, b, c]);
  const { tree, leafId } = splitWithTab(left, left.id, 'right', d);
  return { tree, leftId: left.id, rightId: leafId, tabs: { a, b, c, d } };
}

test('undo restores the layout and focus from before closing other tabs', () => {
  const { tree, leftId, tabs } = fixture();
  const after = closeTabs(tree, [tabs.a.id, tabs.c.id]);
  const snap = snapshotLayout(tree, after, leftId, 1000);
  const back = undoLayout(after, snap, 1000 + UNDO_MS - 1);
  assert.ok(back);
  assert.deepEqual(back.layout, tree);
  assert.equal(back.focusedId, leftId);
});

test('undo brings back a closed panel with all its tabs', () => {
  const { tree, rightId, tabs } = fixture();
  const after = removeLeaf(tree, rightId) as LayoutNode;
  assert.equal(allLeaves(after).length, 1);
  const back = undoLayout(after, snapshotLayout(tree, after, rightId, 0), 10);
  assert.ok(back);
  assert.equal(allLeaves(back.layout).length, 2);
  assert.ok(allTabs(back.layout).some((x) => x.tab.id === tabs.d.id));
});

test('undo compares by content, so a layout that went through sync still matches', () => {
  const { tree, tabs } = fixture();
  const after = closeTabs(tree, [tabs.b.id]);
  const synced = migrate(JSON.parse(JSON.stringify(after)));
  assert.notEqual(synced, after);
  assert.ok(sameLayout(synced, after));
  assert.ok(undoLayout(synced, snapshotLayout(tree, after, null, 0), 1));
});

test('undo is refused after the timeout', () => {
  const { tree, tabs } = fixture();
  const after = closeTabs(tree, [tabs.b.id]);
  assert.equal(undoLayout(after, snapshotLayout(tree, after, null, 0), UNDO_MS + 1), null);
});

test('undo is refused once another change landed after the close', () => {
  const { tree, rightId, tabs } = fixture();
  const after = closeTabs(tree, [tabs.b.id]) as LayoutNode;
  const snap = snapshotLayout(tree, after, null, 0);
  // 別の画面から届いた変更（パネルを閉じた）
  const changed = removeLeaf(after, rightId);
  assert.equal(undoLayout(changed, snap, 1), null);
  assert.equal(undoLayout(after, null, 1), null);
});
