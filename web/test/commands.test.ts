import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMenu, COMMANDS, FAMILIES, type AppContext, type CommandContext } from '../src/commands';
import { MENUS, WORKSPACE_MENU } from '../src/menus';
import type { MenuItem } from '../src/components/ContextMenu';

const all = [...COMMANDS, ...FAMILIES];

test('command ids and labels are unique', () => {
  const ids = all.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate id: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
  const labels = all.map(c => c.label);
  assert.equal(new Set(labels).size, labels.length, `duplicate label: ${labels.filter((l, i) => labels.indexOf(l) !== i)}`);
});

test('every command has a group, a scope and a run function', () => {
  for (const c of all) {
    assert.ok(c.group, `${c.id} has no group`);
    assert.ok(c.scope, `${c.id} has no scope`);
    assert.equal(typeof c.run, 'function', `${c.id} has no run`);
  }
});

test('every menu slot names a registered command', () => {
  const ids = new Set(all.map(c => c.id));
  for (const [name, slots] of Object.entries(MENUS)) {
    for (const slot of slots) {
      if (slot === null) continue;
      const id = typeof slot === 'string' ? slot : slot.id;
      assert.ok(ids.has(id), `${name} menu refers to unknown command ${id}`);
    }
  }
});

const app = (over: Partial<AppContext> = {}): AppContext => ({
  session: null, window: null, activePane: null, mode: 'mirror', showStatusBar: false, showKeyBar: false,
  onAction() {}, onNewTab() {}, onLaunchAgent() {}, launchingAgent: null, onSplitNewWindow() {}, onToggle() {},
  onCopyPane() {}, onKillPane() {}, onOpenFiles() {}, onRemoteControl() {}, onOpenScreen() {}, onOpenScreenTab() {},
  onOpenSwitcher() {}, onSendCommand() {}, onPaste() {}, ...over,
});

const labels = (ctx: CommandContext) => buildMenu(WORKSPACE_MENU, ctx).map(e => (e ? e.label : '---'));

test('workspace menu keeps its order and labels', () => {
  assert.deepEqual(labels({ app: app() }), [
    '新しい端末をタブで開く', '新しい端末を右に並べる', '新しい端末を下に並べる', 'ウィンドウを切り替える…', '---',
    'Claude を新しいタブで起動', 'Codex を新しいタブで起動', '---',
    '作業フォルダーのファイルを見る', 'コマンドを送る…', '本文をコピー', 'ペインを全画面 / 元に戻す', 'ペインを閉じる…', '---',
    'リモートデスクトップをタブで開く', 'リモートデスクトップをダイアログで開く', 'キーバーを表示', 'tmux のステータス行を表示', '直接接続に切り替える',
  ]);
  const first = buildMenu(WORKSPACE_MENU, { app: app() })[0] as MenuItem;
  assert.equal(first.hint, 'Alt+T');
  const split = buildMenu(WORKSPACE_MENU, { app: app() })[1] as MenuItem;
  assert.equal(split.disabled, true);
  assert.ok(split.disabledReason);
});

test('menu items run the registered action with their context', () => {
  const calls: string[] = [];
  const items = buildMenu(WORKSPACE_MENU, { app: app({ onNewTab: () => calls.push('new'), onToggle: k => calls.push(k) }) });
  (items[0] as MenuItem).run();
  (items.at(-1) as MenuItem).run();
  assert.deepEqual(calls, ['new', 'mode']);
});
