import { buildMenu, SEP, type CommandContext, type MenuSlot } from './commands';
import type { MenuEntry } from './components/ContextMenu';

/**
 * 各メニューの並び。項目の中身（ラベル・ヒント・押せない理由・実行内容）は commands.ts の登録表にあり、
 * ここでは「どのメニューに、どの順で出すか」だけを決める。
 */

/** パネル ⋯ の後半に付く、端末とワークスペースの操作 */
export const WORKSPACE_MENU: readonly MenuSlot[] = [
  'terminal.newTab',
  'terminal.splitRight',
  'terminal.splitBottom',
  'navigate.switcher',
  SEP,
  'agent.claude',
  'agent.codex',
  'agent.remoteControl',
  'agent.exitClaude',
  SEP,
  'pane.files',
  'pane.sendCommand',
  'pane.copyAll',
  'pane.zoom',
  'pane.kill',
  SEP,
  'screen.openTab',
  'screen.openDialog',
  'view.keyBar',
  'view.statusBar',
  'view.mode',
  'view.altKeys',
];

/**
 * 端末を右クリックしたときのメニュー。tmux の display-menu の代わり。
 * 選択があるときはそれが主役。「全文をコピー」を先頭に置くと、選択したつもりで
 * 画面全体が入ってしまうので、選択の有無で並びを変える（選択の項目は選択があるときだけ出る）
 */
export const TERMINAL_MENU: readonly MenuSlot[] = [
  'selection.copy',
  'selection.clear',
  SEP,
  'terminal.newTab',
  { id: 'terminal.splitRight', hint: '画面を分割' },
  { id: 'terminal.splitBottom', hint: '画面を分割' },
  SEP,
  'pane.copyAll',
  'clipboard.paste',
  SEP,
  'panel.toggleFocus',
  SEP,
  'tab.close',
];

/** タブを右クリックしたときのメニュー */
export const TAB_MENU: readonly MenuSlot[] = [
  'tab.moveLeft',
  'tab.moveRight',
  'tab.moveToDesktop',
  SEP,
  'tab.close',
  'tab.closeOthers',
  'tab.closeRight',
  SEP,
  'tab.splitRight',
  'tab.splitBottom',
  SEP,
  'tab.moveToPanel',
  SEP,
  'screen.tabAsDialog',
  'window.rename',
  'window.kill',
];

/** タブ列の ＋ */
export const NEW_MENU: readonly MenuSlot[] = [
  'create.terminalHere',
  'create.terminalOnDevice',
  SEP,
  'create.screenOnDevice',
];

/** タブ列の ⋯（このあとに WORKSPACE_MENU が続く） */
export const PANEL_MENU: readonly MenuSlot[] = [
  'panel.overview',
  'panel.toggleFocus',
  'panel.activeTabMenu',
  'panel.close',
];

/** 仮想デスクトップのタブを右クリック・長押ししたときのメニュー */
export const DESKTOP_MENU: readonly MenuSlot[] = ['desktop.rename'];

/** ステータスバーの文字サイズ */
export const FONT_SIZE_MENU: readonly MenuSlot[] = ['font.larger', 'font.smaller', 'font.min', SEP, 'font.reset'];

/** ステータスバーの行間 */
export const LINE_HEIGHT_MENU: readonly MenuSlot[] = ['lineHeight.wider', 'lineHeight.narrower', 'lineHeight.min', SEP, 'lineHeight.reset'];

export const MENUS = {
  workspace: WORKSPACE_MENU,
  terminal: TERMINAL_MENU,
  tab: TAB_MENU,
  new: NEW_MENU,
  panel: PANEL_MENU,
  desktop: DESKTOP_MENU,
  fontSize: FONT_SIZE_MENU,
  lineHeight: LINE_HEIGHT_MENU,
} as const;

export const workspaceMenuItems = (ctx: CommandContext): MenuEntry[] => buildMenu(WORKSPACE_MENU, ctx);
