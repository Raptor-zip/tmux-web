import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMenu, COMMANDS, commandShortcuts, FAMILIES, findCommand, matchesCommand, paletteCommands, type AppContext, type CommandContext, type MenuSlot, type TabContext } from '../src/commands';
import { DESKTOP_MENU, FONT_SIZE_MENU, LINE_HEIGHT_MENU, MENUS, NEW_MENU, TAB_MENU } from '../src/menus';
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
  const check = (name: string, slots: readonly MenuSlot[]) => {
    for (const slot of slots) {
      if (slot === null || (typeof slot !== 'string' && 'heading' in slot)) continue;
      if (typeof slot !== 'string' && 'submenu' in slot) { check(`${name} > ${slot.submenu}`, slot.items); continue; }
      const id = typeof slot === 'string' ? slot : slot.id;
      assert.ok(ids.has(id), `${name} menu refers to unknown command ${id}`);
    }
  };
  for (const [name, slots] of Object.entries(MENUS)) check(name, slots);
});

const app = (over: Partial<AppContext> = {}): AppContext => ({
  session: null, window: null, activePane: null, mode: 'mirror', showStatusBar: false, inputBar: 'auto', altKeys: true,
  onAction() {}, onNewTab() {}, onLaunchAgent() {}, launchingAgent: null, onSplitNewWindow() {}, onOpenNewMenu() {}, onToggle() {},
  onCopyPane() {}, onKillPane() {}, onOpenFiles() {}, onRemoteControl() {}, onExitClaude() {}, onOpenScreen() {}, onOpenScreenTab() {},
  onOpenSwitcher() {}, onOpenShortcuts() {}, approvalPending: false, onOpenApproval() {}, onSendCommand() {}, onSelectText() {}, onPaste() {}, ...over,
});

const tab = (over: Partial<TabContext> = {}): TabContext => ({
  index: 0, count: 2, screen: false, hasWindow: true, others: 1, right: 1,
  desktops: [{ id: 'd2', name: '作業2' }], panels: [{ id: 'p2', name: 'api', tabs: 3 }],
  moveLeft() {}, moveRight() {}, moveToDesktop() {}, moveToPanel() {}, close() {}, closeOthers() {}, closeRight() {},
  split() {}, openAsDialog() {}, renameWindow() {}, killWindow() {}, ...over,
});
const names = (slots: readonly MenuSlot[], ctx: CommandContext) => buildMenu(slots, ctx).map(e => (e ? e.label : '---'));

const sub = (items: ReturnType<typeof buildMenu>, label: string) => (items.find(e => e?.label === label) as MenuItem).submenu!;
const full = (over: { app?: Partial<AppContext>; tab?: Partial<TabContext>; text?: string; maximized?: boolean } = {}): CommandContext => ({
  app: app({ screenTab: over.tab?.screen, ...over.app }), selection: { text: over.text ?? '', copy() {}, clear() {} }, tab: tab(over.tab),
  panel: { multiple: true, maximized: over.maximized, toggleFocus() {} },
  strip: { tabCount: 2, closable: true, closePanel() {} },
});
const pane = { id: '%1', index: 0, busy: false, proc: null } as unknown as AppContext['activePane'];

test('tab menu groups placement, tmux and bulk close into submenus', () => {
  const items = buildMenu(TAB_MENU, full({ app: { activePane: pane } }));
  assert.deepEqual(items.map(e => (e ? e.label : '---')), [
    '全文をコピー（履歴込み）', 'テキストを選んでコピー…', '貼り付け', '---',
    '作業フォルダーを開く', 'コマンドを送る…', '---',
    '配置', 'tmux', '---', 'タブを閉じる', 'まとめて閉じる',
  ]);
  const names = (label: string) => sub(items, label).map(e => (e ? e.label : '---'));
  assert.deepEqual(names('配置'), ['パネルを最大化', '右に分割して移す', '下に分割して移す', '「api」のパネルへ移す', 'ワークスペース「作業2」へ移す', '左へ移す', '右へ移す']);
  assert.deepEqual(names('tmux'), ['端末の名前を変更…', 'ペインを拡大（tmux）', 'ペインを終了…', '端末を終了…']);
  assert.deepEqual(names('まとめて閉じる'), ['他のタブ（1）', '右側のタブ（1）', 'このパネル（2 タブ）']);
  assert.ok(!items.some(e => e?.label === '新規'), 'creating moved to the new menu (＋▾)');
  assert.ok(!items.some(e => e?.label === '表示と設定'), 'settings moved to the 表示と接続 dialog');
  // 最大化中は「並びに戻す」になる
  assert.equal(sub(buildMenu(TAB_MENU, full({ maximized: true })), '配置')[0]!.label, '並びに戻す');
  // 移す先のパネルにはタブ数を添える
  assert.equal((sub(items, '配置')[3] as MenuItem).hint, '3 タブ');
});

test('tab menu shows selection and agent items only when they apply', () => {
  const withSelection = buildMenu(TAB_MENU, full({ text: 'a\nb' }));
  assert.deepEqual(withSelection.slice(0, 3).map(e => (e ? e.label : '---')), ['選択をコピー（2 行）', '選択を解除', '---']);
  assert.equal((withSelection[0] as MenuItem).hint, 'Ctrl+Shift+C');
  const claude = { ...pane, proc: { agent: 'Claude' } } as unknown as AppContext['activePane'];
  const agent = buildMenu(TAB_MENU, full({ app: { activePane: claude } })).map(e => (e ? e.label : '---'));
  assert.ok(agent.includes('Claude アプリに接続…') && agent.includes('Claude を終了…'));
  const plain = buildMenu(TAB_MENU, full()).map(e => (e ? e.label : '---'));
  assert.ok(!plain.includes('Claude を終了…'));
  // 前面にないタブには貼り付けられない
  const paste = buildMenu(TAB_MENU, full({ app: { canPaste: false } })).find(e => e?.label === '貼り付け') as MenuItem;
  assert.equal(paste.disabled, true);
  assert.ok(paste.disabledReason);
});

test('tab menu switches screen/terminal items and runs with its context', () => {
  const screen = buildMenu(TAB_MENU, full({ tab: { screen: true } }));
  assert.ok(screen.some(e => e?.label === 'ダイアログで大きく開く'));
  assert.ok(!screen.some(e => e?.label === 'tmux' || e?.label === '全文をコピー（履歴込み）'), 'tmux and pane actions are hidden on a screen tab');
  const moved: string[] = [];
  const items = buildMenu(TAB_MENU, full({ tab: { moveToPanel: id => moved.push(id), moveToDesktop: id => moved.push(id) } }));
  (sub(items, '配置').find(e => e?.label === 'ワークスペース「作業2」へ移す') as MenuItem).run();
  (sub(items, '配置').find(e => e?.label === '「api」のパネルへ移す') as MenuItem).run();
  assert.deepEqual(moved, ['d2', 'p2']);
  // 一つしかないパネルは閉じられない。パネルの最大化も押せない
  const single = buildMenu(TAB_MENU, { ...full(), panel: { multiple: false, toggleFocus() {} }, strip: { tabCount: 1, closable: false, closePanel() {} } });
  assert.equal((sub(single, 'まとめて閉じる').at(-1) as MenuItem).disabled, true);
  assert.equal((sub(single, '配置')[0] as MenuItem).disabled, true);
});

test('menu items run the registered action with their context', () => {
  const calls: string[] = [];
  (buildMenu(NEW_MENU, full({ app: { onNewTab: () => calls.push('new') } }))[0] as MenuItem).run();
  // 表示の切り替えはパレットの『操作』から（『表示と接続』と同じ値）
  const ctx = (over: Partial<AppContext> = {}) => ({ app: app({ onToggle: k => calls.push(k), onOpenSettings: () => calls.push('settings'), ...over }) });
  const list = paletteCommands(ctx());
  list.find(c => c.id === 'view.mode')!.run();
  const alt = list.find(c => c.id === 'view.altKeys')!;
  assert.equal(alt.hint, 'オン');
  alt.run();
  list.find(c => c.id === 'view.settings')!.run();
  assert.deepEqual(calls, ['new', 'mode', 'altKeys', 'settings']);
  assert.equal(paletteCommands(ctx({ altKeys: false })).find(c => c.id === 'view.altKeys')!.hint, 'オフ');
  assert.equal(list.find(c => c.id === 'view.inputBar')!.hint, '自動 → 常に表示');
  // アプリとして開いているときは『アプリとして追加』を出さない
  assert.ok(paletteCommands(ctx({ onInstallApp() {} })).some(c => c.id === 'app.install'));
  assert.ok(!paletteCommands(ctx({ onInstallApp() {}, appInstalled: true })).some(c => c.id === 'app.install'));
});

test('Claude exit asks before sending /exit', () => {
  const sent: unknown[] = [];
  const claude = { id: '%1', busy: false, proc: { agent: 'Claude' } } as unknown as AppContext['activePane'];
  const items = buildMenu(TAB_MENU, full({ app: { activePane: claude, onAction: (_a, p) => sent.push(p), onExitClaude: () => sent.push('confirm') } }));
  const exit = items.find(e => e?.label === 'Claude を終了…') as MenuItem;
  assert.equal(exit.danger, true);
  exit.run();
  assert.deepEqual(sent, ['confirm'], 'the menu only opens the confirmation; /exit is sent after it');
});

test('new menu: terminal, Claude and Codex with side placements, other devices, remote desktops and creators', () => {
  const calls: string[] = [];
  const devices = [{ id: 'a', name: 'A', connected: true }, { id: 'b', name: 'B', connected: false }, { id: 'c', name: 'C', connected: true }];
  const create = {
    devices, current: 'c', newTerminal: (id?: string) => calls.push(`term:${id}`), openScreen: (id: string) => calls.push(`screen:${id}`),
    newProject: () => calls.push('project'), openFolder: () => calls.push('folder'), resume: () => calls.push('resume'), newSession: () => calls.push('session'),
  };
  const items = buildMenu(NEW_MENU, { app: app({ canOpenTerminal: true, onSplitNewWindow: (side, agent) => calls.push(`split:${side}:${agent ?? 'term'}`) }), create });
  assert.deepEqual(items.map(e => (e ? e.label : '---')), [
    '端末', 'Claude', 'Codex', '---', '別のデバイスで', 'リモートデスクトップ', '---',
    'プロジェクトを作る…', 'フォルダーを開く…', '過去の会話を再開…', 'tmux セッションを作る…',
  ]);
  const rows = items.slice(0, 3) as MenuItem[];
  assert.deepEqual(rows.map(r => [r.accel, r.hint]), [['t', 'Alt+T'], ['c', 'Alt+Shift+C'], ['x', 'Alt+Shift+X']]);
  assert.deepEqual(rows.map(r => r.side!.map(s => `${s.label}=${s.ariaLabel}`)), [
    ['右に並べる=新しい端末を右に並べる', '下に並べる=新しい端末を下に並べる'],
    ['右に並べる=Claude を右に並べる', '下に並べる=Claude を下に並べる'],
    ['右に並べる=Codex を右に並べる', '下に並べる=Codex を下に並べる'],
  ]);
  rows[1].side![1].run();
  // 入力先のデバイス（C）は『端末』と同じなので、別のデバイスには出さない
  const other = sub(items, '別のデバイスで') as MenuItem[];
  assert.deepEqual(other.map(e => `${e.label}${e.disabled ? ` (${e.disabledReason})` : ''}`), ['A', 'B (このデバイスは接続していません)']);
  other[0].run();
  // リモートデスクトップは入力先を先頭に、R で開く
  const screen = items.find(e => e?.label === 'リモートデスクトップ') as MenuItem;
  assert.equal(screen.accel, 'r');
  assert.deepEqual(screen.submenu!.map(e => (e ? `${e.label}${e.disabled ? ' (x)' : ''}${(e as MenuItem).hint ? ` [${(e as MenuItem).hint}]` : ''}` : '---')),
    ['C [入力先]', 'A', 'B (x)', '---', 'ダイアログで開く']);
  (screen.submenu![0] as MenuItem).run();
  for (const label of ['プロジェクトを作る…', 'フォルダーを開く…', '過去の会話を再開…', 'tmux セッションを作る…']) (items.find(e => e?.label === label) as MenuItem).run();
  assert.deepEqual(calls, ['split:bottom:claude', 'term:a', 'screen:c', 'project', 'folder', 'resume', 'session']);
  // ほかのデバイスが無ければ『別のデバイスで ▸』ごと出さない
  const alone = buildMenu(NEW_MENU, { app: app(), create: { ...create, devices: [devices[2]] } });
  assert.ok(!alone.some(e => e?.label === '別のデバイスで'));
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
  // パネル ⋯ の『選択中のタブの操作…』と『タブ・パネルの一覧』はタブメニューとパレットに置き換えた
  assert.equal(findCommand('panel.activeTabMenu'), undefined);
  assert.equal(findCommand('panel.overview'), undefined);
});

test('palette commands search labels and aliases and run with their context', () => {
  const calls: string[] = [];
  const list = paletteCommands({ app: app({ onNewTab: () => calls.push('new'), onOpenSwitcher: () => calls.push('palette') }) }, new Set(['navigate.switcher']));
  assert.ok(!list.some(c => c.id === 'navigate.switcher'), 'excluded commands are left out');
  assert.ok(!list.some(c => c.id === 'tab.close'), 'commands without their context are left out');
  assert.ok(!list.some(c => c.id === 'navigate.approval'), 'approval appears only while one is pending');
  const find = (q: string) => list.filter(c => matchesCommand(c, q)).map(c => c.label);
  assert.ok(find('本文をコピー').includes('全文をコピー（履歴込み）'), 'old names find the renamed command');
  assert.ok(find('キーバー').includes('入力行の表示を切り替える'), 'old names find the renamed command');
  assert.ok(find('新しい 端末 タブ').includes('新しい端末'), 'every word must match (old names are aliases)');
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
  for (const k of ['Alt+T', 'Alt+W', 'Alt+P', 'Alt+/', 'Alt+Enter', 'Alt+Shift+T', 'Alt+Shift+C', 'Alt+Shift+X']) assert.ok(keys.includes(k), `${k} is listed`);
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
