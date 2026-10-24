import { Icon } from './Icon';
import type { Pane, Session, TmuxWindow } from '../types';
import { SEP, type MenuEntry } from './ContextMenu';

interface Props {
  session: Session | null;
  window: TmuxWindow | null;
  activePane: Pane | null;
  mode: 'mirror' | 'direct';
  showStatusBar: boolean;
  showKeyBar: boolean;
  onAction(action: string, params: Record<string, unknown>): void;
  /** 新しいウィンドウを作って、いまのタイルにタブで足す */
  onNewTab(): void;
  onLaunchAgent(agent: 'claude' | 'codex'): void;
  launchingAgent: 'claude' | 'codex' | null;
  onToggleSidebar(): void;
  /** 新しいウィンドウを作って、その向きに並べる */
  onSplitNewWindow(side: 'right' | 'bottom'): void;
  onToggle(key: 'mode' | 'showStatusBar' | 'showKeyBar'): void;
  onCopyPane(): void;
  onKillPane(): void;
  onOpenFiles(): void;
  onRemoteControl(): void;
  onOpenScreen(): void;
  onOpenSwitcher(): void;
  onOpenCheatSheet(): void;
  onSendCommand(): void;
  /** 右端の「⋯」で開くメニュー。中身をここで組み立てて親に渡す */
  onOpenMenu(items: MenuEntry[], x: number, y: number): void;
}

/** タブ列に置く一覧ボタンと作業メニュー。 */
export function Toolbar({
  session,
  window: win,
  activePane,
  mode,
  showStatusBar,
  showKeyBar,
  onAction,
  onNewTab,
  onLaunchAgent,
  launchingAgent,
  onToggleSidebar,
  onSplitNewWindow,
  onToggle,
  onCopyPane,
  onKillPane,
  onOpenFiles,
  onRemoteControl,
  onOpenScreen,
  onOpenSwitcher,
  onOpenCheatSheet,
  onSendCommand,
  onOpenMenu,
}: Props) {
  const pane = activePane?.id;
  const moreItems = (): MenuEntry[] => [
    { label: '新しい端末をタブで開く', hint: 'Alt+T', run: onNewTab },
    { label: '作業フォルダーのファイルを見る', run: onOpenFiles, disabled: !pane },
    ...(activePane?.proc?.agent === 'Claude' ? [
      { label: 'Claude アプリに接続…', run: onRemoteControl },
      { label: 'Claude を終了する', run: () => pane && onAction('runCommand', { target: pane, command: '/exit' }), disabled: activePane.busy },
    ] : []),
    SEP,
    { label: 'Claude を新しいタブで起動', run: () => onLaunchAgent('claude'), disabled: !session || launchingAgent !== null },
    { label: 'Codex を新しいタブで起動', run: () => onLaunchAgent('codex'), disabled: !session || launchingAgent !== null },
    SEP,
    { label: 'デバイスの画面を見る', run: onOpenScreen },
    { label: 'ウィンドウを切り替える…', hint: 'Alt+P', run: onOpenSwitcher },
    { label: 'コマンドを送る…', run: onSendCommand, disabled: !pane },
    { label: '新しい端末を右に並べる', run: () => onSplitNewWindow('right'), disabled: !win },
    { label: '新しい端末を下に並べる', run: () => onSplitNewWindow('bottom'), disabled: !win },
    { label: '本文をコピー', run: onCopyPane, disabled: !pane },
    SEP,
    {
      label: 'ペインを全画面 / 元に戻す',
      run: () => pane && onAction('zoomPane', { target: pane }),
      disabled: !pane,
    },
    { label: 'ペインを閉じる…', run: onKillPane, disabled: !pane },
    SEP,
    { label: `キーバーを${showKeyBar ? '隠す' : '表示'}`, run: () => onToggle('showKeyBar') },
    {
      label: `tmux のステータス行を${showStatusBar ? '隠す' : '表示'}`,
      run: () => onToggle('showStatusBar'),
    },
    {
      label: mode === 'mirror' ? '直接接続に切り替える' : 'ミラー接続に切り替える',
      run: () => onToggle('mode'),
    },
    SEP,
    { label: 'tmux チートシート', hint: 'Alt+/', run: onOpenCheatSheet },
  ];

  return (
    <div className="workspace-actions">
      <button className="icon-btn" onClick={onToggleSidebar} aria-label="セッション一覧の開閉" title="セッション一覧 (Alt+B)"><Icon name="menu" /></button>
      <button className="icon-btn" title="作業の操作" aria-label="作業の操作" aria-haspopup="menu"
        onClick={e => { const r = e.currentTarget.getBoundingClientRect(); onOpenMenu(moreItems(), r.right, r.bottom); }}><Icon name="more" /></button>
    </div>
  );
}
