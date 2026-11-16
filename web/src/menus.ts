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
  'screen.tabAsDialog',
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

/** 仮想デスクトップのタブを右クリック・長押ししたときのメニュー */
export const DESKTOP_MENU: readonly MenuSlot[] = ['desktop.rename'];

export const MENUS = {
  tab: TAB_MENU,
  new: NEW_MENU,
  desktop: DESKTOP_MENU,
} as const;

export const tabMenuItems = (ctx: CommandContext): MenuEntry[] => buildMenu(TAB_MENU, ctx);
