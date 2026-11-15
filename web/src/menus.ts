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
  // 新規メニュー（＋▾）と『表示と接続』ができるまでの置き場。旧ワークスペースメニューの残り
  { submenu: '新規', items: [
    'terminal.newTab',
    'terminal.splitRight',
    'terminal.splitBottom',
    SEP,
    'agent.claude',
    'agent.codex',
    SEP,
    'screen.openTab',
    'screen.openDialog',
  ] },
  { submenu: '表示と設定', items: [
    'navigate.switcher',
    'navigate.shortcuts',
    SEP,
    'view.keyBar',
    'view.statusBar',
    'view.mode',
    'view.altKeys',
  ] },
  SEP,
  'tab.close',
  { submenu: 'まとめて閉じる', items: ['tab.closeOthers', 'tab.closeRight', 'panel.close'] },
];

/** タブ列の ＋ */
export const NEW_MENU: readonly MenuSlot[] = [
  'create.terminalHere',
  'create.terminalOnDevice',
  SEP,
  'create.screenOnDevice',
];

/** 仮想デスクトップのタブを右クリック・長押ししたときのメニュー */
export const DESKTOP_MENU: readonly MenuSlot[] = ['desktop.rename'];

/** ステータスバーの文字サイズ */
export const FONT_SIZE_MENU: readonly MenuSlot[] = ['font.larger', 'font.smaller', 'font.min', SEP, 'font.reset'];

/** ステータスバーの行間 */
export const LINE_HEIGHT_MENU: readonly MenuSlot[] = ['lineHeight.wider', 'lineHeight.narrower', 'lineHeight.min', SEP, 'lineHeight.reset'];

export const MENUS = {
  tab: TAB_MENU,
  new: NEW_MENU,
  desktop: DESKTOP_MENU,
  fontSize: FONT_SIZE_MENU,
  lineHeight: LINE_HEIGHT_MENU,
} as const;

export const tabMenuItems = (ctx: CommandContext): MenuEntry[] => buildMenu(TAB_MENU, ctx);
