import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMenu, COMMANDS, commandShortcuts, FAMILIES, findCommand, matchesCommand, paletteCommands, type AppContext, type CommandContext, type MenuSlot, type TabContext } from '../src/commands';
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
  onOpenSwitcher() {}, onOpenShortcuts() {}, approvalPending: false, onOpenApproval() {}, onSendCommand() {}, onPaste() {}, ...over,
});

const labels = (ctx: CommandContext) => buildMenu(WORKSPACE_MENU, ctx).map(e => (e ? e.label : '---'));

test('workspace menu keeps its order and labels', () => {
  assert.deepEqual(labels({ app: app() }), [
    '新しい端末をタブで開く', '新しい端末を右に並べる', '新しい端末を下に並べる', '探す・操作', '---',
    'Claude を新しいタブで起動', 'Codex を新しいタブで起動', '---',
    '作業フォルダーを開く', 'コマンドを送る…', '全文をコピー（履歴込み）', 'ペインを拡大（tmux）', 'ペインを終了…', '---',
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
    '全文をコピー（履歴込み）', '貼り付け', '---', 'パネルを最大化 / 並びに戻す', '---', 'タブを閉じる',
  ]);
  const withSelection = buildMenu(TERMINAL_MENU, ctx('a\nb'));
  assert.deepEqual((withSelection[0] as MenuItem), { ...(withSelection[0] as MenuItem), label: '選択をコピー', hint: '2 行' });
  assert.equal((withSelection.find(e => e?.label === 'パネルを最大化 / 並びに戻す') as MenuItem).disabled, true);
  // 入力先のタブが無いときも「タブを閉じる」は押せない項目として残る
  const noTab = buildMenu(TERMINAL_MENU, { ...ctx(''), tab: undefined });
  assert.equal((noTab.at(-1) as MenuItem).label, 'タブを閉じる');
  assert.equal((noTab.at(-1) as MenuItem).disabled, true);
});

test('tab menu keeps its order and switches screen/terminal items', () => {
  assert.deepEqual(names(TAB_MENU, { tab: tab() }), [
    '左へ移す', '右へ移す', '作業2 へ移動', '---', 'タブを閉じる', '他のタブを閉じる', '右側のタブを閉じる', '---',
    '右に分割して移す', '下に分割して移す', '---', 'パネル 2 へ移動（3タブ）', '---', '端末の名前を変更…', '端末を終了…',
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

test('renamed commands keep their old names as search aliases', () => {
  const renamed: Record<string, string[]> = {
    'pane.copyAll': ['本文をコピー', '画面全体をコピー'],
    'pane.files': ['作業フォルダーのファイルを見る'],
    'pane.zoom': ['ペインを全画面 / 元に戻す'],
    'pane.kill': ['ペインを閉じる…'],
    'selection.copy': ['選択部分をコピー'],
    'tab.splitRight': ['右に切り出す'],
    'tab.splitBottom': ['下に切り出す'],
    'window.rename': ['ウィンドウ名を変更…'],
    'window.kill': ['ウィンドウを閉じる…'],
    'panel.toggleFocus': ['このパネルを広げる / 元に戻す'],
  };
  for (const [id, old] of Object.entries(renamed)) {
    const command = findCommand(id);
    assert.ok(command, id);
    for (const name of old) assert.ok(command.aliases?.includes(name), `${id} keeps ${name}`);
  }
  // 同じ処理だった 2 つのコピーは 1 つにまとめた
  assert.equal(findCommand('pane.copyText'), undefined);
  assert.equal(findCommand('pane.copyScreen'), undefined);
});

test('palette commands search labels and aliases and run with their context', () => {
  const calls: string[] = [];
  const list = paletteCommands({ app: app({ onNewTab: () => calls.push('new'), onOpenSwitcher: () => calls.push('palette') }) }, new Set(['navigate.switcher']));
  assert.ok(!list.some(c => c.id === 'navigate.switcher'), 'excluded commands are left out');
  assert.ok(!list.some(c => c.id === 'tab.close'), 'commands without their context are left out');
  assert.ok(!list.some(c => c.id === 'navigate.approval'), 'approval appears only while one is pending');
  const find = (q: string) => list.filter(c => matchesCommand(c, q)).map(c => c.label);
  assert.ok(find('本文をコピー').includes('全文をコピー（履歴込み）'), 'old names find the renamed command');
  assert.ok(find('キーバー').includes('キーバーの表示を切り替える'), 'menu labels are searchable');
  assert.ok(find('新しい 端末 タブ').includes('新しい端末をタブで開く'), 'every word must match');
  assert.deepEqual(find('no-such-command'), []);
  list.find(c => c.id === 'terminal.newTab')!.run();
  assert.deepEqual(calls, ['new']);
  const split = list.find(c => c.id === 'terminal.splitRight')!;
  assert.ok(split.disabledReason, 'disabled commands carry their reason');
  const pending = paletteCommands({ app: app({ approvalPending: true }) });
  assert.ok(pending.some(c => c.label === '承認待ちを確認'));
  const devices = paletteCommands({ create: { devices: [{ id: 'a', name: 'A', connected: true }, { id: 'b', name: 'B', connected: false }], newTerminal() {}, openScreen() {} } });
  assert.deepEqual(devices.filter(c => c.id === 'create.terminalOnDevice').map(c => [c.label, !!c.disabledReason]), [['A で端末を開く', false], ['B で端末を開く', true]]);
});

test('shortcut list is generated from command hints', () => {
  const keys = commandShortcuts().map(s => s.keys);
  for (const k of ['Alt+T', 'Alt+W', 'Alt+P', 'Alt+/', 'Alt+Enter']) assert.ok(keys.includes(k), `${k} is listed`);
  assert.ok(!keys.includes('6px'), 'non-key hints are not shortcuts');
});

test('menus can carry headings, one-level submenus and accelerator keys', () => {
  const ran: string[] = [];
  const ctx: CommandContext = { tab: tab({ moveLeft: () => ran.push('left') }) };
  const items = buildMenu([
    { heading: '配置' },
    { submenu: '配置', accel: 'l', items: [{ id: 'tab.moveLeft', accel: 'h' }, 'tab.moveRight'] },
    null,
    { heading: '空の段' },
    null,
    { submenu: '出ない段', items: ['screen.tabAsDialog'] },
  ], ctx);
  // 中身の無いサブメニューと、直後が区切りの見出しは出さない
  assert.deepEqual(items.map(e => (e ? e.label : '---')), ['配置', '配置']);
  assert.equal((items[0] as { heading?: true }).heading, true);
  const sub = items[1] as MenuItem;
  assert.equal(sub.accel, 'l');
  assert.deepEqual(sub.submenu!.map(e => (e ? e.label : '---')), ['左へ移す', '右へ移す']);
  assert.equal((sub.submenu![0] as MenuItem).accel, 'h');
  (sub.submenu![0] as MenuItem).run();
  assert.deepEqual(ran, ['left']);
  assert.throws(() => buildMenu([{ submenu: 'a', items: [{ submenu: 'b', items: [] }] }], ctx), /nested submenu/);
});
