import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMenu, COMMANDS, FAMILIES, type AppContext, type CommandContext, type MenuSlot, type TabContext } from '../src/commands';
import { DESKTOP_MENU, FONT_SIZE_MENU, LINE_HEIGHT_MENU, MENUS, NEW_MENU, TAB_MENU, TERMINAL_MENU, WORKSPACE_MENU } from '../src/menus';
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
  session: null, window: null, activePane: null, mode: 'mirror', showStatusBar: false, showKeyBar: false, altKeys: true,
  onAction() {}, onNewTab() {}, onLaunchAgent() {}, launchingAgent: null, onSplitNewWindow() {}, onToggle() {},
  onCopyPane() {}, onKillPane() {}, onOpenFiles() {}, onRemoteControl() {}, onExitClaude() {}, onOpenScreen() {}, onOpenScreenTab() {},
  onOpenSwitcher() {}, onSendCommand() {}, onPaste() {}, ...over,
});

const labels = (ctx: CommandContext) => buildMenu(WORKSPACE_MENU, ctx).map(e => (e ? e.label : '---'));

test('workspace menu keeps its order and labels', () => {
  assert.deepEqual(labels({ app: app() }), [
    '新しい端末をタブで開く', '新しい端末を右に並べる', '新しい端末を下に並べる', 'ウィンドウを切り替える…', '---',
    'Claude を新しいタブで起動', 'Codex を新しいタブで起動', '---',
    '作業フォルダーのファイルを見る', 'コマンドを送る…', '本文をコピー', 'ペインを全画面 / 元に戻す', 'ペインを閉じる…', '---',
    'リモートデスクトップをタブで開く', 'リモートデスクトップをダイアログで開く', 'キーバーを表示', 'tmux のステータス行を表示', '直接接続に切り替える',
    'Alt ショートカットを使う',
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
  (items.find(e => e?.label === '直接接続に切り替える') as MenuItem).run();
  (items.at(-1) as MenuItem).run();
  assert.deepEqual(calls, ['new', 'mode', 'altKeys']);
});

test('Alt shortcut toggle shows its state and Claude exit asks before sending /exit', () => {
  const alt = (on: boolean) => buildMenu(WORKSPACE_MENU, { app: app({ altKeys: on }) }).at(-1) as MenuItem;
  assert.equal(alt(true).hint, 'オン');
  assert.equal(alt(false).hint, 'オフ');
  const sent: unknown[] = [];
  const claude = { id: '%1', busy: false, proc: { agent: 'Claude' } } as unknown as AppContext['activePane'];
  const items = buildMenu(WORKSPACE_MENU, { app: app({ activePane: claude, onAction: (_a, p) => sent.push(p), onExitClaude: () => sent.push('confirm') }) });
  const exit = items.find(e => e?.label === 'Claude を終了…') as MenuItem;
  assert.equal(exit.danger, true);
  exit.run();
  assert.deepEqual(sent, ['confirm'], 'the menu only opens the confirmation; /exit is sent after it');
});

const tab = (over: Partial<TabContext> = {}): TabContext => ({
  index: 0, count: 2, screen: false, hasWindow: true, others: 1, right: 1,
  desktops: [{ id: 'd2', name: '作業2' }], panels: [{ id: 'p2', number: 2, tabs: 3 }],
  moveLeft() {}, moveRight() {}, moveToDesktop() {}, moveToPanel() {}, close() {}, closeOthers() {}, closeRight() {},
  split() {}, openAsDialog() {}, renameWindow() {}, killWindow() {}, ...over,
});
const names = (slots: readonly MenuSlot[], ctx: CommandContext) => buildMenu(slots, ctx).map(e => (e ? e.label : '---'));

test('terminal menu shows selection items only when text is selected', () => {
  const ctx = (text: string): CommandContext => ({
    app: app(), selection: { text, copy() {}, clear() {} }, panel: { multiple: false, toggleFocus() {} }, tab: tab(),
  });
  assert.deepEqual(names(TERMINAL_MENU, ctx('')), [
    '新しい端末をタブで開く', '新しい端末を右に並べる', '新しい端末を下に並べる', '---',
    '画面全体をコピー', '貼り付け', '---', 'このパネルを広げる / 元に戻す', '---', 'タブを閉じる',
  ]);
  const withSelection = buildMenu(TERMINAL_MENU, ctx('a\nb'));
  assert.deepEqual((withSelection[0] as MenuItem), { ...(withSelection[0] as MenuItem), label: '選択部分をコピー', hint: '2 行' });
  assert.equal((withSelection.find(e => e?.label === 'このパネルを広げる / 元に戻す') as MenuItem).disabled, true);
  // 入力先のタブが無いときも「タブを閉じる」は押せない項目として残る
  const noTab = buildMenu(TERMINAL_MENU, { ...ctx(''), tab: undefined });
  assert.equal((noTab.at(-1) as MenuItem).label, 'タブを閉じる');
  assert.equal((noTab.at(-1) as MenuItem).disabled, true);
});

test('tab menu keeps its order and switches screen/terminal items', () => {
  assert.deepEqual(names(TAB_MENU, { tab: tab() }), [
    '左へ移動', '右へ移動', '作業2 へ移動', '---', 'タブを閉じる', '他のタブを閉じる', '右側のタブを閉じる', '---',
    '右に切り出す', '下に切り出す', '---', 'パネル 2 へ移動（3タブ）', '---', 'ウィンドウ名を変更…', 'ウィンドウを閉じる…',
  ]);
  assert.deepEqual(names(TAB_MENU, { tab: tab({ screen: true }) }).slice(-1), ['ダイアログで大きく開く']);
  const moved: string[] = [];
  const items = buildMenu(TAB_MENU, { tab: tab({ moveToPanel: id => moved.push(id), moveToDesktop: id => moved.push(id) }) });
  (items.find(e => e?.label === '作業2 へ移動') as MenuItem).run();
  (items.find(e => e?.label === 'パネル 2 へ移動（3タブ）') as MenuItem).run();
  assert.deepEqual(moved, ['d2', 'p2']);
});

test('new-tab menu lists every device and disables offline ones', () => {
  const items = buildMenu(NEW_MENU, { create: { devices: [{ id: 'a', name: 'A', connected: true }, { id: 'b', name: 'B', connected: false }], newTerminal() {}, openScreen() {} } });
  assert.deepEqual(items.map(e => (e ? `${e.label}${e.disabled ? ' (x)' : ''}` : '---')), [
    '現在のデバイスで端末を開く', 'A で端末を開く', 'B で端末を開く (x)', '---', 'A のリモートデスクトップを開く', 'B のリモートデスクトップを開く (x)',
  ]);
});

test('font size and line height menus keep their short labels and limits', () => {
  let font = 6;
  let line = 1;
  const view = { fontSize: font, lineHeight: line, setFontSize: (u: (v: number) => number) => { font = u(font); }, setLineHeight: (v: number) => { line = v; }, stepLineHeight: (d: number) => { line += d; } };
  assert.deepEqual(names(FONT_SIZE_MENU, { view }), ['大きく', '小さく', '最小にする', '---', '既定に戻す']);
  assert.deepEqual(names(LINE_HEIGHT_MENU, { view }), ['広げる', '詰める', '最小にする', '---', '既定に戻す']);
  const fonts = buildMenu(FONT_SIZE_MENU, { view }) as MenuItem[];
  assert.equal(fonts[1].disabled, true);
  fonts[0].run();
  assert.equal(font, 7);
  (buildMenu(LINE_HEIGHT_MENU, { view })[4] as MenuItem).run();
  assert.equal(line, 1.15);
  assert.deepEqual(names(DESKTOP_MENU, { desktop: { rename() {} } }), ['名前を変更…']);
});
