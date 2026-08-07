import { useMemo, useRef, useState } from 'react';
import type { DragPayload } from './SplitView';
import type { Pane, Session, TmuxWindow } from '../types';

interface Props {
  sessions: Session[];
  windows: TmuxWindow[];
  panes: Pane[];
  home: string;
  activeSessionId: string | null;
  activeWindowId: string | null;
  /** いまタイルに表示されているウィンドウ。分割中の見分け用 */
  openWindowIds: (string | null)[];
  connected: boolean;
  unauthorized: boolean;
  serverVersion?: string;
  onSelectSession(id: string): void;
  onSelectWindow(win: TmuxWindow): void;
  onAction(action: string, params: Record<string, unknown>): void;
  onNewSession(): void;
  onConfirm(message: string, detail: string, run: () => void): void;
  /** 一定距離ドラッグしたら呼ばれる。ここから先はターミナル側が受け取る */
  onStartDrag(payload: DragPayload): void;
  /** サイドバー内に落とされた。tmux 側の移動はここで起こる */
  onDropInTree(target: TreeDropTarget, payload: DragPayload): void;
  drag: DragPayload | null;
  draggingWindowId: string | null;
}

/** サイドバーの行に落としたときの落とし先 */
export type TreeDropTarget =
  | { kind: 'session'; sessionId: string }
  | { kind: 'window'; windowId: string; sessionId: string; place: 'before' | 'after' };

/** 表示用にパスを縮める。ホーム直下なら `~`、それ以外は末尾のディレクトリ名 */
function shortPath(path: string, home: string): string {
  if (!path) return '';
  if (path === home) return '~';
  const leaf = path.replace(/\/+$/, '').split('/').pop();
  return leaf || path;
}

export function Sidebar({
  sessions,
  windows,
  panes,
  home,
  activeSessionId,
  activeWindowId,
  openWindowIds,
  connected,
  unauthorized,
  serverVersion,
  onSelectSession,
  onSelectWindow,
  onAction,
  onNewSession,
  onConfirm,
  onStartDrag,
  onDropInTree,
  drag,
  draggingWindowId,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ kind: 'session' | 'window'; id: string } | null>(
    null,
  );
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('');

  /** ウィンドウごとの「代表するペイン」。アクティブなペイン、無ければ先頭 */
  const leadPane = useMemo(() => {
    const map = new Map<string, Pane>();
    for (const p of panes) {
      const cur = map.get(p.windowId);
      if (!cur) {
        map.set(p.windowId, p);
      } else if (!cur.active && (p.active || p.index < cur.index)) {
        map.set(p.windowId, p);
      }
    }
    return map;
  }, [panes]);

  /** ウィンドウ 1 行に出す情報をまとめる */
  const describe = (win: TmuxWindow) => {
    const pane = leadPane.get(win.id);
    const title = pane?.title?.trim() ?? '';
    const dir = shortPath(pane?.path ?? '', home);
    // 端末タイトルがあればそれを主役にする（ウィンドウ名が "claude" だらけでも見分けられる）
    const primary = title || win.name;
    const secondary = [title ? win.name : null, dir].filter(Boolean).join(' · ');
    return {
      primary,
      secondary,
      busy: pane?.busy ?? false,
      fullPath: pane?.path ?? '',
      command: pane?.command ?? '',
    };
  };

  /**
   * ポインタを押してから 6px 動いたらドラッグ開始とみなす。
   * HTML5 の draggable ではタッチ操作で動かないので使わない。
   */
  const pending = useRef<{ x: number; y: number; payload: DragPayload } | null>(null);

  const armDrag = (e: React.PointerEvent, payload: DragPayload) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pending.current = { x: e.clientX, y: e.clientY, payload };

    const move = (ev: PointerEvent) => {
      const p = pending.current;
      if (!p) return;
      if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) < 6) return;
      cleanup();
      onStartDrag(p.payload);
    };
    const cleanup = () => {
      pending.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  };

  /**
   * ドラッグ中に指が乗っている行。ここに落とすと tmux 側が動く。
   * SplitView のようなオーバーレイは張らない。行が自分でポインタを受けたほうが、
   * 行の高さがまちまちでもスクロールしても当たり判定がずれない。
   */
  const [dropAt, setDropAt] = useState<TreeDropTarget | null>(null);

  /** その組み合わせに意味があるか（自分自身への移動などを弾く） */
  const canDrop = (t: TreeDropTarget): boolean => {
    if (!drag) return false;
    if (drag.kind === 'session') {
      // セッションはセッションにしか合流できない
      return t.kind === 'session' && t.sessionId !== drag.sessionId;
    }
    if (t.kind === 'session') return t.sessionId !== drag.sessionId;
    return t.windowId !== drag.windowId;
  };

  const hoverRow = (e: React.PointerEvent, t: TreeDropTarget) => {
    if (!drag) return;
    let next = t;
    if (t.kind === 'window') {
      // 行の上半分なら手前、下半分なら後ろに差し込む
      const r = e.currentTarget.getBoundingClientRect();
      next = { ...t, place: e.clientY < r.top + r.height / 2 ? 'before' : 'after' };
    }
    setDropAt(canDrop(next) ? next : null);
  };

  const dropRow = (t: TreeDropTarget) => {
    const at = dropAt ?? t;
    if (drag && canDrop(at)) onDropInTree(at, drag);
    setDropAt(null);
  };

  /** その行がいま落とし先になっているか。CSS の当たり先を決めるためだけに使う */
  const dropClass = (t: TreeDropTarget): string => {
    if (!dropAt || dropAt.kind !== t.kind) return '';
    if (dropAt.kind === 'session') {
      return dropAt.sessionId === (t as { sessionId: string }).sessionId ? 'drop-into' : '';
    }
    const w = t as { windowId: string };
    if (dropAt.windowId !== w.windowId) return '';
    return dropAt.place === 'before' ? 'drop-before' : 'drop-after';
  };

  const openSet = useMemo(
    () => new Set(openWindowIds.filter((id): id is string => Boolean(id))),
    [openWindowIds],
  );

  const query = filter.trim().toLowerCase();
  const matches = (win: TmuxWindow, sessionName: string) => {
    if (!query) return true;
    const d = describe(win);
    return [sessionName, win.name, d.primary, d.secondary, d.fullPath, d.command]
      .join(' ')
      .toLowerCase()
      .includes(query);
  };

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const startRename = (kind: 'session' | 'window', id: string, current: string) => {
    setRenaming({ kind, id });
    setDraft(current);
  };

  const commitRename = () => {
    if (!renaming) return;
    const name = draft.trim();
    if (name) {
      onAction(renaming.kind === 'session' ? 'renameSession' : 'renameWindow', {
        target: renaming.id,
        name,
      });
    }
    setRenaming(null);
  };

  const renameInput = (onDone: () => void) => (
    <input
      className="rename-input"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone();
        if (e.key === 'Escape') setRenaming(null);
      }}
    />
  );

  const visibleSessions = sessions
    .map((session) => ({
      session,
      wins: windows
        .filter((w) => w.sessionId === session.id && matches(w, session.name))
        .sort((a, b) => a.index - b.index),
    }))
    .filter(({ session, wins }) => !query || wins.length > 0 || session.name.toLowerCase().includes(query));

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <div className="brand">
          <span className="brand-mark">▤</span>
          <span className="brand-text">tmux web</span>
        </div>
        <span className={`dot ${connected ? 'ok' : 'bad'}`} title={connected ? '接続中' : '切断'} />
      </header>

      <div className="sidebar-actions">
        <button className="btn primary block" onClick={onNewSession}>
          ＋ セッションを作る
        </button>
        <div className="filter-wrap">
          <input
            className="sidebar-filter"
            placeholder="作業内容・パスで絞り込む…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button className="filter-clear" title="クリア" onClick={() => setFilter('')}>
              ✕
            </button>
          )}
        </div>
      </div>

      <nav
        className={`tree ${drag ? 'dropping' : ''}`}
        onPointerLeave={() => setDropAt(null)}
      >
        {visibleSessions.length === 0 && (
          <p className="empty">
            {query ? (
              <>「{filter}」に一致するウィンドウはありません。</>
            ) : unauthorized ? (
              <>
                認証されていません（401）。
                <br />
                <code>?token=...</code> 付きの URL で開き直してください。
              </>
            ) : (
              <>
                セッションがありません。
                <br />
                上のボタンから作成してください。
              </>
            )}
          </p>
        )}

        {visibleSessions.map(({ session, wins }) => {
          const isOpen = Boolean(query) || !collapsed.has(session.id);
          const isActive = session.id === activeSessionId;

          return (
            <div key={session.id} className={`tree-session ${isActive ? 'active' : ''}`}>
              <div
                className={`row session-row ${dropClass({
                  kind: 'session',
                  sessionId: session.id,
                })} ${drag?.kind === 'session' && drag.sessionId === session.id ? 'dragging' : ''}`}
                onPointerDown={(e) =>
                  armDrag(e, {
                    kind: 'session',
                    sessionId: session.id,
                    windowId: null,
                    label: session.name,
                  })
                }
                onPointerMove={(e) => hoverRow(e, { kind: 'session', sessionId: session.id })}
                onPointerUp={() => dropRow({ kind: 'session', sessionId: session.id })}
                title={
                  drag
                    ? 'ここに落とすとこのセッションへ移ります'
                    : 'ドラッグして別のセッションに重ねるとひとつにまとまります'
                }
              >
                <button className="twisty" onClick={() => toggle(session.id)}>
                  {isOpen ? '▾' : '▸'}
                </button>

                {renaming?.kind === 'session' && renaming.id === session.id ? (
                  renameInput(commitRename)
                ) : (
                  <button
                    className="row-label"
                    onClick={() => onSelectSession(session.id)}
                    onDoubleClick={() => startRename('session', session.id, session.name)}
                    title={session.path}
                  >
                    <span className="name">{session.name}</span>
                    <span className="meta">
                      {session.windows}w
                      {session.attached > 0 && <span className="badge attached">接続中</span>}
                    </span>
                  </button>
                )}

                <div className="row-tools">
                  <button
                    title="ウィンドウを追加"
                    onClick={() => onAction('newWindow', { target: session.id })}
                  >
                    ＋
                  </button>
                  <button
                    title="名前を変更"
                    onClick={() => startRename('session', session.id, session.name)}
                  >
                    ✎
                  </button>
                  <button
                    className="danger"
                    title="セッションを削除"
                    onClick={() =>
                      onConfirm(
                        `セッション「${session.name}」を削除しますか？`,
                        `${session.windows} 個のウィンドウと、その中で動いているプロセスがすべて終了します。`,
                        () => onAction('killSession', { target: session.id }),
                      )
                    }
                  >
                    ✕
                  </button>
                </div>
              </div>

              {isOpen &&
                wins.map((win) => {
                  const winActive = win.id === activeWindowId;
                  const opened = openSet.has(win.id);
                  const d = describe(win);
                  return (
                    <div
                      key={win.id}
                      className={`row window-row ${winActive ? 'active' : ''} ${
                        opened && !winActive ? 'opened' : ''
                      } ${draggingWindowId === win.id ? 'dragging' : ''} ${dropClass({
                        kind: 'window',
                        windowId: win.id,
                        sessionId: win.sessionId,
                        place: 'before',
                      })}`}
                      onPointerDown={(e) =>
                        armDrag(e, {
                          kind: 'window',
                          sessionId: win.sessionId,
                          windowId: win.id,
                          label: d.primary,
                        })
                      }
                      onPointerMove={(e) =>
                        hoverRow(e, {
                          kind: 'window',
                          windowId: win.id,
                          sessionId: win.sessionId,
                          place: 'before',
                        })
                      }
                      onPointerUp={() =>
                        dropRow({
                          kind: 'window',
                          windowId: win.id,
                          sessionId: win.sessionId,
                          place: 'before',
                        })
                      }
                      title={
                        drag
                          ? 'ここに落とすとこの位置に差し込まれます'
                          : 'ドラッグ：右の端に落とすと画面分割、別のセッションに落とすと移動'
                      }
                    >
                      <span className="win-index">{win.index}</span>

                      {renaming?.kind === 'window' && renaming.id === win.id ? (
                        renameInput(commitRename)
                      ) : (
                        <button
                          className="row-label window-label"
                          onClick={() => onSelectWindow(win)}
                          onDoubleClick={() => startRename('window', win.id, win.name)}
                          title={`${win.name}\n${d.primary}\n${d.fullPath} (${d.command})`}
                        >
                          <span className="line-main">
                            {d.busy && <span className="busy" title="実行中" />}
                            <span className="name">{d.primary}</span>
                          </span>
                          {d.secondary && <span className="line-sub">{d.secondary}</span>}
                        </button>
                      )}

                      <span className="win-flags">
                        {win.panes > 1 && <span className="badge">{win.panes}p</span>}
                        {win.zoomed && <span className="badge zoom">Z</span>}
                        {win.bell && <span className="badge bell">!</span>}
                        {win.activity && !winActive && (
                          <span className="badge act" title="新しい出力あり">
                            ●
                          </span>
                        )}
                      </span>

                      <div className="row-tools">
                        <button
                          title="名前を変更"
                          onClick={() => startRename('window', win.id, win.name)}
                        >
                          ✎
                        </button>
                        <button
                          className="danger"
                          title="ウィンドウを閉じる"
                          onClick={() =>
                            onConfirm(
                              `ウィンドウ「${win.name}」を閉じますか？`,
                              d.primary !== win.name ? d.primary : `${d.fullPath} で動いています。`,
                              () => onAction('killWindow', { target: win.id }),
                            )
                          }
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </nav>

      <footer className="sidebar-foot">
        <span>{serverVersion ?? ''}</span>
      </footer>
    </aside>
  );
}
