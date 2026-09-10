import { Fragment, type ReactElement } from 'react';
import { projectName, tildePath } from '../paths';
import type { Pane, Session, TmuxWindow } from '../types';
import { SEP, type MenuEntry } from './ContextMenu';

interface Props {
  session: Session | null;
  window: TmuxWindow | null;
  activePane: Pane | null;
  /** ホームディレクトリ。パンくずのパスを `~` に畳むのに使う */
  home: string;
  tileCount: number;
  tabCount: number;
  mode: 'mirror' | 'direct';
  showStatusBar: boolean;
  showKeyBar: boolean;
  connected: boolean;
  statusMessage?: string;
  onAction(action: string, params: Record<string, unknown>): void;
  /** 新しいウィンドウを作って、いまのタイルにタブで足す */
  onNewTab(): void;
  /** 新しいウィンドウを作って、その向きに並べる */
  onSplitNewWindow(side: 'right' | 'bottom'): void;
  onToggle(key: 'mode' | 'showStatusBar' | 'showKeyBar'): void;
  onCopyPane(): void;
  onKillPane(): void;
  onOpenSwitcher(): void;
  onOpenCheatSheet(): void;
  onSendCommand(): void;
  /** 右端の「⋯」で開くメニュー。中身をここで組み立てて親に渡す */
  onOpenMenu(items: MenuEntry[], x: number, y: number): void;
}

/**
 * VS Code のエディタ上部に倣った細い操作バー。
 * 左にパンくず、右によく使うアイコンだけを置き、残りは「⋯」にしまう。
 * ボタンを 20 個並べておくより、目当てのものに届くまでが短い。
 */
export function Toolbar({
  session,
  window: win,
  activePane,
  home,
  tileCount,
  tabCount,
  mode,
  showStatusBar,
  showKeyBar,
  connected,
  statusMessage,
  onAction,
  onNewTab,
  onSplitNewWindow,
  onToggle,
  onCopyPane,
  onKillPane,
  onOpenSwitcher,
  onOpenCheatSheet,
  onSendCommand,
  onOpenMenu,
}: Props) {
  const pane = activePane?.id;
  // パンくずの先頭はプロジェクト名。セッション名やウィンドウ番号より、
  // 「どのプロジェクトを触っているか」のほうが手を止めずに確かめたい
  const project = projectName(activePane, home);

  const moreItems = (): MenuEntry[] => [
    { label: 'ウィンドウを切り替える…', hint: 'Alt+P', run: onOpenSwitcher },
    { label: 'コマンドを送る…', run: onSendCommand, disabled: !pane },
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

  /**
   * パンくず。先頭はプロジェクト名で、そこから tmux 側の居場所へ降りていく。
   * セッション名がプロジェクト名と同じときは繰り返さない（同じ語が 2 つ並ぶだけ）。
   */
  const crumbs = (): ReactElement[] =>
    [
      project ? (
        <span className="crumb project" title={tildePath(activePane?.path ?? '', home)}>
          {project}
        </span>
      ) : null,
      session && session.name !== project ? (
        <span className="crumb strong">{session.name}</span>
      ) : null,
      win ? (
        <span className="crumb">
          {win.index}:{win.name}
        </span>
      ) : null,
      activePane ? (
        <span className="crumb dim">
          pane {activePane.index} · {activePane.command}
        </span>
      ) : null,
    ].filter((node): node is ReactElement => node !== null);

  return (
    <div className="editorbar">
      <div className="crumbs">
        {session ? (
          <>
            {crumbs().map((node, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="sep">›</span>}
                {node}
              </Fragment>
            ))}
            {tileCount > 1 && <span className="tile-count">{tileCount} 分割</span>}
            {tabCount > 1 && <span className="tile-count">{tabCount} タブ</span>}
          </>
        ) : (
          <span className="dim">開いているタブがありません</span>
        )}
      </div>

      <div className="editorbar-actions">
        {statusMessage && !connected && <span className="term-status">{statusMessage}</span>}
        <button
          className="icon-btn"
          title="新しい端末をタブで開く (Alt+T)"
          aria-label="新しい端末をタブで開く"
          onClick={onNewTab}
        >
          ＋
        </button>
        <button
          className="icon-btn"
          disabled={!win}
          title="新しい端末を右に並べる"
          aria-label="新しい端末を右に並べる"
          onClick={() => onSplitNewWindow('right')}
        >
          ▥
        </button>
        <button
          className="icon-btn"
          disabled={!win}
          title="新しい端末を下に並べる"
          aria-label="新しい端末を下に並べる"
          onClick={() => onSplitNewWindow('bottom')}
        >
          ⊟
        </button>
        <button
          className="icon-btn"
          title="ウィンドウを切り替える (Alt+P)"
          aria-label="ウィンドウを切り替える"
          onClick={onOpenSwitcher}
        >
          ⇄
        </button>
        <button
          className="icon-btn"
          title="その他の操作"
          aria-label="その他の操作"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onOpenMenu(moreItems(), r.right, r.bottom);
          }}
        >
          ⋯
        </button>
      </div>
    </div>
  );
}
