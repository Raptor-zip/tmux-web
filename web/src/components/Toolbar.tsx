import { Fragment, type ReactElement } from 'react';
import { LAYOUTS } from '../types';
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
  mode: 'mirror' | 'direct';
  showStatusBar: boolean;
  showPaneMap: boolean;
  showKeyBar: boolean;
  connected: boolean;
  statusMessage?: string;
  onAction(action: string, params: Record<string, unknown>): void;
  /** 新しいウィンドウを作って、その向きに並べる */
  onSplitNewWindow(side: 'right' | 'bottom'): void;
  onToggle(key: 'mode' | 'showStatusBar' | 'showPaneMap' | 'showKeyBar'): void;
  onCopyPane(): void;
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
  mode,
  showStatusBar,
  showPaneMap,
  showKeyBar,
  connected,
  statusMessage,
  onAction,
  onSplitNewWindow,
  onToggle,
  onCopyPane,
  onOpenCheatSheet,
  onSendCommand,
  onOpenMenu,
}: Props) {
  const pane = activePane?.id;
  // パンくずの先頭はプロジェクト名。セッション名やウィンドウ番号より、
  // 「どのプロジェクトを触っているか」のほうが手を止めずに確かめたい
  const project = projectName(activePane, home);

  const moreItems = (): MenuEntry[] => [
    { label: 'コマンドを送る…', run: onSendCommand, disabled: !pane },
    { label: '本文をコピー', run: onCopyPane, disabled: !pane },
    SEP,
    ...LAYOUTS.map((l) => ({
      label: `ペイン配置: ${l.label}`,
      run: () => win && onAction('setLayout', { target: win.id, layout: l.id }),
      disabled: !win,
    })),
    SEP,
    { label: `ペイン配置図を${showPaneMap ? '隠す' : '表示'}`, run: () => onToggle('showPaneMap') },
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
          </>
        ) : (
          <span className="dim">セッションが選択されていません</span>
        )}
      </div>

      <div className="editorbar-actions">
        {statusMessage && !connected && <span className="term-status">{statusMessage}</span>}
        <button
          className="icon-btn"
          disabled={!win}
          title="新しいウィンドウを右に並べる"
          onClick={() => onSplitNewWindow('right')}
        >
          ▥
        </button>
        <button
          className="icon-btn"
          disabled={!win}
          title="新しいウィンドウを下に並べる"
          onClick={() => onSplitNewWindow('bottom')}
        >
          ⊟
        </button>
        <button
          className="icon-btn"
          disabled={!win}
          title="このセッションに新しいウィンドウを作る"
          onClick={() => win && onAction('newWindow', { target: win.sessionId })}
        >
          ＋
        </button>
        <button
          className="icon-btn"
          disabled={!pane}
          title="ペインを全画面 / 元に戻す"
          onClick={() => onAction('zoomPane', { target: pane })}
        >
          ⤢
        </button>
        <button
          className="icon-btn danger"
          disabled={!pane}
          title="このペインを閉じる（確認なし）"
          onClick={() => onAction('killPane', { target: pane })}
        >
          ✕
        </button>
        <button
          className="icon-btn"
          title="その他の操作"
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
