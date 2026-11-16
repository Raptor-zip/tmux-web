import { buildMenu, SEP, type CommandContext, type MenuSlot } from './commands';
import type { MenuEntry } from './components/ContextMenu';

/**
 * 各メニューの並び。項目の中身（ラベル・ヒント・押せない理由・実行内容）は commands.ts の登録表にあり、
 * ここでは「どのメニューに、どの順で出すか」だけを決める。
 */

/**
 * タブメニュー。タブの右クリック・長押し、タイル見出しの ⋯（タブの操作）、端末の右クリック・長押しで
 * 同じものを開く。見出しには対象のタブ名を出す（ContextMenu の title）。
 * 選択の項目は選択があるときだけ、エージェントの項目はエージェントのときだけ出る。
 * 選択があるときはそれが主役なので先頭に置く（「全文をコピー」が先だと、選択したつもりで全文が入る）。
 */
export const TAB_MENU: readonly MenuSlot[] = [
  'selection.copy',
  'selection.clear',
  SEP,
  'pane.copyAll',
  'pane.selectText',
  'clipboard.paste',
  SEP,
  'pane.files',
  'pane.sendCommand',
  SEP,
  'agent.remoteControl',
  'agent.exitClaude',
  SEP,
  { submenu: '配置', items: [
    'panel.toggleFocus',
    'tab.splitRight',
    'tab.splitBottom',
    'tab.moveToPanel',
    'tab.moveToDesktop',
    'tab.moveLeft',
    'tab.moveRight',
  ] },
  { submenu: 'tmux', items: ['window.rename', 'pane.zoom', 'pane.kill', 'window.kill'] },
  SEP,
  'tab.close',
  { submenu: 'まとめて閉じる', items: ['tab.closeOthers', 'tab.closeRight', 'panel.close'] },
];

/**
 * 画面メニュー。画面タブではタブメニューの先頭の段に入れ、ダイアログでは見出しの ⋯ で開く。
 * 『Esc を送る』は見出しに入りきらない狭いタイルのときだけ出る。全画面は Fullscreen API があるときだけ。
 */
export const SCREEN_MENU: readonly MenuSlot[] = [
  'screen.viewOnly',
  'screen.fit',
  SEP,
  'screen.text',
  'screen.copy',
  'screen.sendEscape',
  'screen.reconnect',
  SEP,
  'screen.fullscreen',
  'screen.asDialog',
  'screen.toTab',
  { submenu: '別のデバイスに切り替え', items: ['screen.switchDevice'] },
  SEP,
  'screen.quality',
  'screen.ctrlAltDel',
  'screen.guide',
];

/**
 * 新規メニュー（タイル見出しの ＋▾、Alt+Shift+T）。
 * 先頭の 3 行は 1 文字キー（T・C・X）で選べ、行の右の『右に並べる』『下に並べる』で隣のパネルに開く。
 * 入力先のデバイスでの端末は先頭の『端末』なので、『別のデバイスで ▸』には他のデバイスだけを出す。
 */
export const NEW_MENU: readonly MenuSlot[] = [
  { id: 'terminal.newTab', label: '端末', accel: 't', side: ['terminal.splitRight', 'terminal.splitBottom'] },
  { id: 'agent.claude', label: 'Claude', accel: 'c', side: ['agent.claudeRight', 'agent.claudeBottom'] },
  { id: 'agent.codex', label: 'Codex', accel: 'x', side: ['agent.codexRight', 'agent.codexBottom'] },
  SEP,
  { submenu: '別のデバイスで', items: ['create.terminalOnDevice'] },
  { submenu: 'リモートデスクトップ', accel: 'r', items: ['create.screenOnDevice', SEP, { id: 'screen.openDialog', label: 'ダイアログで開く' }] },
  SEP,
  'create.project',
  'create.folder',
  'create.resume',
  'create.session',
];

/** ワークスペースのタブを右クリック・長押し・Shift+F10 したときのメニュー */
export const DESKTOP_MENU: readonly MenuSlot[] = [
  'desktop.rename',
  'desktop.new',
  SEP,
  'desktop.moveLeft',
  'desktop.moveRight',
  SEP,
  'desktop.remove',
];

/**
 * 一覧（サイドバー）の見出しの ⋯。めったに変えない並べ方と、まとめて消す片付けはここに置く。
 * 『表示と接続…』は app の文脈があるときだけ出る。
 */
export const LIST_MENU: readonly MenuSlot[] = [
  { submenu: '並べ方', items: ['list.byProject', 'list.bySession'] },
  SEP,
  'list.cleanUp',
  'list.collapseAll',
  'list.expandAll',
  SEP,
  'list.manageDevices',
  'view.settings',
  SEP,
  'list.close',
];

/**
 * 一覧のデバイス見出しの ⋯。『ここで新規 ▸』はそのデバイスを対象にした新規メニューの中身
 * （app と create の文脈を、そのデバイス向けに作り直して渡す）。
 */
export const DEVICE_MENU: readonly MenuSlot[] = [
  { submenu: 'ここで新規', items: [
    { id: 'terminal.newTab', label: '端末' },
    { id: 'agent.claude', label: 'Claude' },
    { id: 'agent.codex', label: 'Codex' },
    SEP,
    'create.project',
    'create.folder',
    'create.resume',
    'create.session',
  ] },
  'device.screen',
  SEP,
  'device.select',
  'device.manage',
];

/**
 * 一覧の行の ⋯・右クリック・長押し。端末の行とグループ（セッション・プロジェクト）の行で同じ並びを使い、
 * 対象に合わない項目は when で消える。『別のセッションへ移す ▸』『別のセッションとまとめる ▸』は
 * ドラッグで別のセッション行に落としたときと同じ処理を呼ぶ。
 */
export const ROW_MENU: readonly MenuSlot[] = [
  'row.open',
  'row.openRight',
  'row.openBottom',
  'row.peek',
  'row.newTerminal',
  SEP,
  'row.rename',
  { submenu: '別のセッションへ移す', items: ['row.moveTo'] },
  { submenu: '別のセッションとまとめる', items: ['row.mergeInto'] },
  SEP,
  'row.cleanUp',
  SEP,
  'row.killWindow',
  'row.killSession',
];

export const MENUS = {
  tab: TAB_MENU,
  screen: SCREEN_MENU,
  new: NEW_MENU,
  desktop: DESKTOP_MENU,
  list: LIST_MENU,
  device: DEVICE_MENU,
  row: ROW_MENU,
} as const;

export const tabMenuItems = (ctx: CommandContext): MenuEntry[] => buildMenu(TAB_MENU, ctx);

export const screenMenuItems = (ctx: CommandContext): MenuEntry[] => buildMenu(SCREEN_MENU, ctx);
