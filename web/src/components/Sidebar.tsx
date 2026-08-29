import { useEffect, useMemo, useRef, useState } from 'react';
import { HoverPreview, type PreviewTarget } from './HoverPreview';
import type { DragPayload } from './SplitView';
import { STATUS_ORDER, relTime, summarize, windowStatus, type StatusKind, type WindowStatus } from '../status';
import type { Pane, Session, TmuxWindow } from '../types';

/** 一覧の並べ方。プロジェクト = 作業ディレクトリのリポジトリ単位 */
export type GroupBy = 'project' | 'session';

interface Props {
  sessions: Session[];
  windows: TmuxWindow[];
  panes: Pane[];
  home: string;
  groupBy: GroupBy;
  activeSessionId: string | null;
  activeWindowId: string | null;
  /** いまタイルに表示されているウィンドウ。分割中の見分け用 */
  openWindowIds: (string | null)[];
  connected: boolean;
  unauthorized: boolean;
  serverVersion?: string;
  onChangeGroupBy(next: GroupBy): void;
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

/** ホームを `~` に畳んだフルパス。見出しの補足とツールチップに使う */
function tildePath(path: string, home: string): string {
  if (!path) return '';
  return home && path.startsWith(home) ? '~' + path.slice(home.length) : path;
}

/** プロジェクトのルートより下にいるときだけ、その相対パスを返す */
function subPath(full: string, root: string): string {
  if (!full || !root || full === root || !full.startsWith(root + '/')) return '';
  return full.slice(root.length + 1);
}

export function Sidebar({
  sessions,
  windows,
  panes,
  home,
  groupBy,
  activeSessionId,
  activeWindowId,
  openWindowIds,
  connected,
  unauthorized,
  serverVersion,
  onChangeGroupBy,
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

  // 「未使用 12分」のような相対時間を、状態が変わらなくても進ませる
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  /** ウィンドウ id → そのウィンドウのペイン（重複して届くので id で畳む） */
  const panesByWindow = useMemo(() => {
    const map = new Map<string, Map<string, Pane>>();
    for (const p of panes) {
      let inner = map.get(p.windowId);
      if (!inner) map.set(p.windowId, (inner = new Map()));
      inner.set(p.id, p);
    }
    return new Map([...map].map(([id, inner]) => [id, [...inner.values()]]));
  }, [panes]);

  /** ウィンドウごとの「代表するペイン」。アクティブなペイン、無ければ先頭 */
  const leadPane = useMemo(() => {
    const map = new Map<string, Pane>();
    for (const [id, list] of panesByWindow) {
      const lead =
        list.find((p) => p.active) ??
        [...list].sort((a, b) => a.index - b.index)[0] ??
        null;
      if (lead) map.set(id, lead);
    }
    return map;
  }, [panesByWindow]);

  const statusOf = useMemo(() => {
    const map = new Map<string, WindowStatus>();
    for (const win of windows) {
      map.set(win.id, windowStatus(win, panesByWindow.get(win.id) ?? [], now));
    }
    return map;
  }, [windows, panesByWindow, now]);

  /** ウィンドウ 1 行に出す情報をまとめる */
  const describe = (win: TmuxWindow) => {
    const pane = leadPane.get(win.id);
    const title = pane?.title?.trim() ?? '';
    const project = pane?.project ?? null;
    const full = pane?.path ?? '';
    // 端末タイトルがあればそれを主役にする（ウィンドウ名が "claude" だらけでも見分けられる）
    const primary = title || win.name;
    const sub = project ? subPath(full, project.root) : '';

    // プロジェクト別に並べているときは、プロジェクト名は見出しに出ているので繰り返さない。
    // 代わりに「どのセッションのウィンドウか」を出す（tmux 側で探すときの手がかり）
    const secondary =
      groupBy === 'project'
        ? [win.sessionName, `${win.index}:${win.name}`, sub].filter(Boolean).join(' · ')
        : [`${win.index}:${win.name}`, project?.name ?? shortPath(full, home), sub]
            .filter(Boolean)
            .join(' · ');

    return {
      primary,
      secondary,
      busy: pane?.busy ?? false,
      fullPath: full,
      command: pane?.command ?? '',
      project,
      status: statusOf.get(win.id) ?? null,
    };
  };

  /**
   * ホバー中の行のプレビュー。ウィンドウを開かずに中身を覗くためのもの。
   * マウス以外（タッチ・ペン）では出さない。指を置いただけで被さると邪魔になる。
   */
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  const hoverPreview = (e: React.PointerEvent, win: TmuxWindow | null, label: string) => {
    if (e.pointerType !== 'mouse' || drag) return;
    const pane = win ? leadPane.get(win.id) : null;
    if (!pane) {
      setPreview(null);
      return;
    }
    const d = win ? describe(win) : null;
    setPreview({
      paneId: pane.id,
      title: d?.primary ?? label,
      subtitle: [label, win ? `${win.index}: ${win.name}` : null, d?.status?.label]
        .filter(Boolean)
        .join(' · '),
      anchor: e.currentTarget.getBoundingClientRect(),
    });
  };

  /** そのセッションでいまアクティブなウィンドウ（セッション行のプレビュー用） */
  const activeWindowOf = (session: Session): TmuxWindow | null =>
    windows.find((w) => w.sessionId === session.id && w.active) ??
    windows.find((w) => w.sessionId === session.id) ??
    null;

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
      setPreview(null);
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
   *
   * プロジェクト別に並べているときは木の形が tmux の構造と一致しないので、
   * 並べ替えの落とし先にはしない（掴んで端末側に落とす＝画面分割だけ効く）。
   */
  const [dropAt, setDropAt] = useState<TreeDropTarget | null>(null);
  const treeDrops = groupBy === 'session';

  /** その組み合わせに意味があるか（自分自身への移動などを弾く） */
  const canDrop = (t: TreeDropTarget): boolean => {
    if (!drag || !treeDrops) return false;
    if (drag.kind === 'session') {
      // セッションはセッションにしか合流できない
      return t.kind === 'session' && t.sessionId !== drag.sessionId;
    }
    if (t.kind === 'session') return t.sessionId !== drag.sessionId;
    return t.windowId !== drag.windowId;
  };

  const hoverRow = (e: React.PointerEvent, t: TreeDropTarget) => {
    if (!drag || !treeDrops) return;
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
  const matches = (win: TmuxWindow) => {
    if (!query) return true;
    const d = describe(win);
    return [win.sessionName, win.name, d.primary, d.secondary, d.fullPath, d.command,
      d.project?.name, d.status?.label, ...(d.status?.chips ?? [])]
      .join(' ')
      .toLowerCase()
      .includes(query);
  };

  // ------------------------------------------------------------------ グループ

  interface Group {
    key: string;
    name: string;
    /** 見出しの下（またはツールチップ）に出す補足 */
    hint: string;
    /** セッション別のときだけ。名前変更・削除の対象 */
    session: Session | null;
    /** プロジェクト別のときだけ。ここにウィンドウを足すときの作業ディレクトリ */
    cwd: string | null;
    wins: TmuxWindow[];
  }

  const groups = useMemo<Group[]>(() => {
    const visible = windows.filter(matches);

    if (groupBy === 'session') {
      return sessions
        .map((session) => ({
          key: session.id,
          name: session.name,
          hint: tildePath(session.path, home),
          session,
          cwd: null,
          wins: visible.filter((w) => w.sessionId === session.id).sort((a, b) => a.index - b.index),
        }))
        .filter((g) => !query || g.wins.length > 0 || g.name.toLowerCase().includes(query));
    }

    const byRoot = new Map<string, Group>();
    for (const win of visible) {
      const pane = leadPane.get(win.id);
      const root = pane?.project?.root ?? pane?.path ?? win.sessionName;
      let g = byRoot.get(root);
      if (!g) {
        byRoot.set(
          root,
          (g = {
            key: root,
            name: pane?.project?.name ?? shortPath(pane?.path ?? '', home) ?? win.sessionName,
            hint: tildePath(root, home),
            session: null,
            cwd: pane?.project?.root ?? pane?.path ?? null,
            wins: [],
          }),
        );
      }
      g.wins.push(win);
    }

    // 動いているプロジェクトを上にまとめる。その中は名前順にして、状態が変わるまで
    // 並びが動かないようにする（毎秒入れ替わると目で追えない）
    const rank = (g: Group) =>
      Math.min(...g.wins.map((w) => STATUS_ORDER.indexOf(statusOf.get(w.id)?.kind ?? 'idle')));
    return [...byRoot.values()]
      .map((g) => ({
        ...g,
        wins: g.wins.sort(
          (a, b) => a.sessionName.localeCompare(b.sessionName) || a.index - b.index,
        ),
      }))
      .sort((a, b) => {
        const ra = rank(a) === STATUS_ORDER.length - 1 ? 1 : 0;
        const rb = rank(b) === STATUS_ORDER.length - 1 ? 1 : 0;
        return ra - rb || a.name.localeCompare(b.name);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, sessions, windows, leadPane, statusOf, home, query]);

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

  /** 見出しの右に出す「作業中 2・未使用 5」の要約 */
  const groupSummary = (g: Group) => {
    const counts = summarize(g.wins.map((w) => statusOf.get(w.id)!).filter(Boolean));
    return STATUS_ORDER.filter((k) => counts[k]).map((k) => (
      <span key={k} className={`tally ${k}`} title={`${k}`}>
        <i />
        {counts[k]}
      </span>
    ));
  };

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

        <div className="group-switch" role="group" aria-label="一覧の並べ方">
          <button
            className={groupBy === 'project' ? 'on' : ''}
            onClick={() => onChangeGroupBy('project')}
            title="作業ディレクトリのリポジトリごとにまとめる"
          >
            プロジェクト別
          </button>
          <button
            className={groupBy === 'session' ? 'on' : ''}
            onClick={() => onChangeGroupBy('session')}
            title="tmux のセッション構造のまま並べる"
          >
            セッション別
          </button>
        </div>

        <div className="filter-wrap">
          <input
            className="sidebar-filter"
            placeholder="作業内容・パス・状態で絞り込む…"
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
        className={`tree ${drag && treeDrops ? 'dropping' : ''}`}
        onPointerLeave={() => {
          setDropAt(null);
          setPreview(null);
        }}
        onScroll={() => setPreview(null)}
      >
        {groups.length === 0 && (
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

        {groups.map((g) => {
          const isOpen = Boolean(query) || !collapsed.has(g.key);
          const session = g.session;
          const isActive = session
            ? session.id === activeSessionId
            : g.wins.some((w) => w.id === activeWindowId);
          const headSessionId = session?.id ?? g.wins[0]?.sessionId ?? null;

          return (
            <div key={g.key} className={`tree-session ${isActive ? 'active' : ''}`}>
              <div
                className={`row session-row ${
                  session ? dropClass({ kind: 'session', sessionId: session.id }) : ''
                } ${
                  drag?.kind === 'session' && session && drag.sessionId === session.id
                    ? 'dragging'
                    : ''
                }`}
                onPointerDown={(e) =>
                  session &&
                  armDrag(e, {
                    kind: 'session',
                    sessionId: session.id,
                    windowId: null,
                    label: session.name,
                  })
                }
                onPointerMove={(e) =>
                  session && hoverRow(e, { kind: 'session', sessionId: session.id })
                }
                onPointerEnter={(e) =>
                  session && hoverPreview(e, activeWindowOf(session), session.name)
                }
                onPointerUp={() => session && dropRow({ kind: 'session', sessionId: session.id })}
                title={
                  session
                    ? drag
                      ? 'ここに落とすとこのセッションへ移ります'
                      : 'ドラッグして別のセッションに重ねるとひとつにまとまります'
                    : g.hint
                }
              >
                <button className="twisty" onClick={() => toggle(g.key)}>
                  {isOpen ? '▾' : '▸'}
                </button>

                {session && renaming?.kind === 'session' && renaming.id === session.id ? (
                  renameInput(commitRename)
                ) : (
                  <button
                    className="row-label group-label"
                    onClick={() => {
                      if (session) onSelectSession(session.id);
                      else if (g.wins[0]) onSelectWindow(g.wins[0]);
                    }}
                    onDoubleClick={() =>
                      session && startRename('session', session.id, session.name)
                    }
                    title={g.hint}
                  >
                    <span className="name">{g.name}</span>
                    <span className="meta">
                      {groupSummary(g)}
                      {session && session.attached > 0 && (
                        <span className="badge attached">接続中</span>
                      )}
                    </span>
                  </button>
                )}

                <div className="row-tools">
                  <button
                    title={
                      session
                        ? 'ウィンドウを追加'
                        : `${g.hint} で新しいウィンドウを開く`
                    }
                    onClick={() =>
                      headSessionId &&
                      onAction('newWindow', {
                        target: headSessionId,
                        ...(g.cwd ? { cwd: g.cwd } : {}),
                      })
                    }
                  >
                    ＋
                  </button>
                  {session && (
                    <>
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
                    </>
                  )}
                </div>
              </div>

              {!session && isOpen && <div className="group-path">{g.hint}</div>}

              {isOpen &&
                g.wins.map((win) => {
                  const winActive = win.id === activeWindowId;
                  const opened = openSet.has(win.id);
                  const d = describe(win);
                  const st = d.status;
                  const kind: StatusKind = st?.kind ?? 'idle';
                  return (
                    <div
                      key={`${g.key}:${win.id}`}
                      className={`row window-row st-${kind} ${winActive ? 'active' : ''} ${
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
                      onPointerEnter={(e) => hoverPreview(e, win, g.name)}
                      onPointerUp={() =>
                        dropRow({
                          kind: 'window',
                          windowId: win.id,
                          sessionId: win.sessionId,
                          place: 'before',
                        })
                      }
                      title={
                        drag && treeDrops
                          ? 'ここに落とすとこの位置に差し込まれます'
                          : 'ドラッグ：右の端に落とすと画面分割、別のセッションに落とすと移動'
                      }
                    >
                      <span className={`state-dot ${kind}`} title={st?.label} />

                      {renaming?.kind === 'window' && renaming.id === win.id ? (
                        renameInput(commitRename)
                      ) : (
                        <button
                          className="row-label window-label"
                          onClick={() => onSelectWindow(win)}
                          onDoubleClick={() => startRename('window', win.id, win.name)}
                          title={`${d.primary}\n${st?.label ?? ''}${
                            d.command ? ` (${d.command})` : ''
                          }\n${d.fullPath}`}
                        >
                          <span className="line-main">
                            <span className="name">{d.primary}</span>
                            {st?.chips.map((c) => (
                              <span key={c} className={`chip ${kind}`}>
                                {c}
                              </span>
                            ))}
                          </span>
                          <span className="line-sub">
                            <span className={`state-text ${kind}`}>{st?.label}</span>
                            {d.secondary && <span className="sub-rest"> · {d.secondary}</span>}
                          </span>
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
                              kind === 'idle'
                                ? `${d.fullPath}\n何も動いていません（最後の出力から ${relTime(
                                    st?.idleFor ?? 0,
                                  )}）。`
                                : `${d.primary}\n${st?.label ?? ''} — 動いているプロセスも終了します。`,
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

      <HoverPreview target={preview} />

      <footer className="sidebar-foot">
        <span>{serverVersion ?? ''}</span>
      </footer>
    </aside>
  );
}
