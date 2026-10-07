import { useMemo, useRef, useState } from 'react';
import { HoverPreview, type PreviewTarget } from './HoverPreview';
import type { DragPayload } from './SplitView';
import {
  STATUS_ORDER,
  STATUS_TEXT,
  isAgentKind,
  relTime,
  summarize,
  type StatusKind,
  type WindowStatus,
} from '../status';
import { shortPath, tildePath } from '../paths';
import type { WindowView } from '../windows';
import type { Session, TmuxWindow } from '../types';

/**
 * これより最近に出力があった未使用ウィンドウは、まとめて閉じる対象から外す。
 * 開いたばかりでまだ何も打っていないウィンドウを巻き込まないため
 */
const RECENT_IDLE_MS = 10 * 60_000;

/** 一覧の並べ方。プロジェクト = 作業ディレクトリのリポジトリ単位 */
export type GroupBy = 'project' | 'session';

interface Props {
  sessions: Session[];
  windows: TmuxWindow[];
  /** ウィンドウ id → 見せ方。タブや切り替えパレットと同じものを使う */
  views: Map<string, WindowView>;
  home: string;
  groupBy: GroupBy;
  activeSessionId: string | null;
  activeWindowId: string | null;
  /** いまタブとして開かれているウィンドウ */
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

export function Sidebar({
  sessions,
  windows,
  views,
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
  /** 未使用の行を広げているグループ。既定は畳む */
  const [idleOpen, setIdleOpen] = useState<Set<string>>(new Set());
  /** 一覧の末尾の「動いていないプロジェクト」を広げているか */
  const [restOpen, setRestOpen] = useState(false);

  /** ウィンドウ 1 行に出す情報。見せ方そのものは windows.ts が持つ */
  const describe = (win: TmuxWindow) => {
    const v = views.get(win.id);
    // プロジェクト別に並べているときは、プロジェクト名は見出しに出ているので繰り返さない。
    // 代わりに「どのセッションのウィンドウか」を出す（tmux 側で探すときの手がかり）
    const secondary =
      groupBy === 'project'
        ? [win.sessionName, v?.where, v?.rel].filter(Boolean).join(' · ')
        : [v?.where, v?.project, v?.rel].filter(Boolean).join(' · ');
    return {
      primary: v?.primary ?? win.name,
      secondary,
      fullPath: v?.fullPath ?? '',
      command: v?.command ?? '',
      project: v?.lead?.project ?? null,
      status: (v?.status ?? null) as WindowStatus | null,
    };
  };

  /**
   * ホバー中の行のプレビュー。ウィンドウを開かずに中身を覗くためのもの。
   * マウス以外（タッチ・ペン）では出さない。指を置いただけで被さると邪魔になる。
   */
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  const hoverPreview = (e: React.PointerEvent, win: TmuxWindow | null, label: string) => {
    if (e.pointerType !== 'mouse' || drag) return;
    const pane = win ? views.get(win.id)?.lead : null;
    if (!pane) {
      setPreview(null);
      return;
    }
    const d = win ? describe(win) : null;
    setPreview({
      paneId: pane.id,
      title: d?.primary ?? label,
      subtitle: [label, win ? views.get(win.id)?.where : null, d?.status?.label]
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
   * 並べ替えの落とし先にはしない（掴んで端末側に落とす＝タブや分割だけ効く）。
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

  // ------------------------------------------------------------------ 未使用の扱い
  //
  // 再起動のたびに resurrect が昔のウィンドウを素の bash で戻すので、放っておくと
  // シェルしかいない行が何十枚も溜まり、動いているエージェントが埋もれる。
  // 一覧では未使用の行を畳み、動いているものだけを前に出す。

  const kindOf = (win: TmuxWindow): StatusKind => views.get(win.id)?.status.kind ?? 'idle';

  /** 並べる段。エージェント → その他の稼働中 → 未使用 */
  const tierOf = (win: TmuxWindow) => {
    const k = kindOf(win);
    return isAgentKind(k) ? 0 : k === 'idle' ? 2 : 1;
  };

  /** 未使用でも畳まずに出す行。いま見ている・タブで開いているものは、隠すと居場所を見失う */
  const pinned = (win: TmuxWindow) => win.id === activeWindowId || openSet.has(win.id);

  /**
   * まとめて閉じてよいウィンドウ。シェルしかいないと確かめられたものに限り、
   * 開いたばかり（直近に出力あり）のものと、タブで開いているものは残す
   */
  const closable = (win: TmuxWindow) => {
    const st = views.get(win.id)?.status;
    return Boolean(st?.vacant) && !pinned(win) && (st?.idleFor ?? 0) >= RECENT_IDLE_MS;
  };

  const cleanUp = (wins: TmuxWindow[], scope: string) => {
    const targets = wins.filter(closable);
    if (targets.length === 0) return;
    const kept = wins.filter((w) => kindOf(w) === 'idle' && !closable(w)).length;
    onConfirm(
      `${scope}未使用のウィンドウを ${targets.length} 枚閉じますか？`,
      'シェルしか動いていないウィンドウだけを閉じます。画面の履歴は残りません。\n' +
        `タブで開いているもの・直近 ${RECENT_IDLE_MS / 60_000} 分に出力があったもの` +
        `${kept ? `（${kept} 枚）` : ''}は残します。\n` +
        '閉じる直前にもう一度プロセスを確かめ、その間に何か動き出したものは閉じません。',
      () => onAction('killIdleWindows', { targets: targets.map((w) => w.id) }),
    );
  };

  const toggleIdle = (key: string) => {
    setIdleOpen((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const query = filter.trim().toLowerCase();
  const matches = (win: TmuxWindow) => {
    if (!query) return true;
    const d = describe(win);
    return [
      win.sessionName,
      win.name,
      d.primary,
      d.secondary,
      d.fullPath,
      d.command,
      d.project?.name,
      d.status?.label,
      ...(d.status?.chips ?? []),
    ]
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
    /** プロジェクト別のときだけ。全部が未使用で、一覧の末尾にまとめて沈めるもの */
    dormant: boolean;
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
          // セッション別は tmux の並びのまま。ドラッグでの並べ替えと位置が食い違わないように
          wins: visible.filter((w) => w.sessionId === session.id).sort((a, b) => a.index - b.index),
          dormant: false,
        }))
        .filter((g) => !query || g.wins.length > 0 || g.name.toLowerCase().includes(query));
    }

    const byRoot = new Map<string, Group>();
    for (const win of visible) {
      const pane = views.get(win.id)?.lead ?? null;
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
            dormant: false,
          }),
        );
      }
      g.wins.push(win);
    }

    // エージェントのいるプロジェクトを上に、動いているものがその次、全部未使用のものは
    // 末尾に沈める。同じ段の中は名前順にして、作業中↔入力待ちのたびに並びが動かない
    // ようにする（毎秒入れ替わると目で追えない）
    const groupTier = (g: Group) => Math.min(...g.wins.map(tierOf));
    return [...byRoot.values()]
      .map((g) => ({
        ...g,
        wins: g.wins.sort(
          (a, b) =>
            tierOf(a) - tierOf(b) ||
            a.sessionName.localeCompare(b.sessionName) ||
            a.index - b.index,
        ),
        dormant: g.wins.every((w) => kindOf(w) === 'idle' && !pinned(w)),
      }))
      .sort((a, b) => groupTier(a) - groupTier(b) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, sessions, windows, views, home, query, activeWindowId, openSet]);

  const liveGroups = groups.filter((g) => !g.dormant);
  const restGroups = groups.filter((g) => g.dormant);

  /** 一覧の頭に出す全体の要約。グループが畳まれていても、何が何枚動いているか分かる */
  const overall = useMemo(() => {
    const seen = new Map<string, TmuxWindow>();
    for (const w of windows) seen.set(w.id, w);
    const all = [...seen.values()];
    const counts = summarize(
      all.map((w) => views.get(w.id)?.status).filter((s): s is WindowStatus => Boolean(s)),
    );
    return { all, counts };
  }, [windows, views]);
  const closableAll = overall.all.filter(closable);

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
    const counts = summarize(
      g.wins.map((w) => views.get(w.id)?.status).filter((s): s is WindowStatus => Boolean(s)),
    );
    return STATUS_ORDER.filter((k) => counts[k]).map((k) => (
      <span key={k} className={`tally ${k}`} title={`${k}`}>
        <i />
        {counts[k]}
      </span>
    ));
  };

  const windowRow = (g: Group, win: TmuxWindow) => {
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
            : 'クリックでタブに開く。ドラッグ：タブ列に落とすと差し込み、端末の端なら画面分割、別のセッション行なら移動'
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
          {opened && (
            <span
              className="badge open"
              title="いまタブとして開いています。選ぶとそのタブに移ります"
            >
              表示中
            </span>
          )}
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
            aria-label="名前を変更"
            onClick={() => startRename('window', win.id, win.name)}
          >
            ✎
          </button>
          <button
            className="danger"
            title="ウィンドウを閉じる（tmux ごと）"
            aria-label="ウィンドウを閉じる"
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
  };

  const groupBlock = (g: Group) => {
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
            drag?.kind === 'session' && session && drag.sessionId === session.id ? 'dragging' : ''
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
          onPointerMove={(e) => session && hoverRow(e, { kind: 'session', sessionId: session.id })}
          onPointerEnter={(e) => session && hoverPreview(e, activeWindowOf(session), session.name)}
          onPointerUp={() => session && dropRow({ kind: 'session', sessionId: session.id })}
          title={
            session
              ? drag
                ? 'ここに落とすとこのセッションへ移ります'
                : 'ドラッグして別のセッションに重ねるとひとつにまとまります'
              : g.hint
          }
        >
          <button
            className="twisty"
            aria-label={isOpen ? '畳む' : '開く'}
            onClick={() => toggle(g.key)}
          >
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
              onDoubleClick={() => session && startRename('session', session.id, session.name)}
              title={g.hint}
            >
              <span className="name">{g.name}</span>
              <span className="meta">
                {groupSummary(g)}
                {session && session.attached > 0 && <span className="badge attached">接続中</span>}
              </span>
            </button>
          )}

          <div className="row-tools">
            <button
              title={session ? 'ウィンドウを追加' : `${g.hint} で新しいウィンドウを開く`}
              aria-label="ウィンドウを追加"
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
                  aria-label="名前を変更"
                  onClick={() => startRename('session', session.id, session.name)}
                >
                  ✎
                </button>
                <button
                  className="danger"
                  title="セッションを削除"
                  aria-label="セッションを削除"
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
          (() => {
            // 未使用の行は既定で畳む。絞り込み中と、全部が未使用のグループは全部出す
            const showAll = Boolean(query) || g.dormant || idleOpen.has(g.key);
            const shown = showAll
              ? g.wins
              : g.wins.filter((w) => kindOf(w) !== 'idle' || pinned(w));
            const idleWins = g.wins.filter((w) => kindOf(w) === 'idle');
            const hidden = g.wins.length - shown.length;
            const canClean = g.wins.filter(closable).length;
            return (
              <>
                {shown.map((win) => windowRow(g, win))}
                {!query &&
                  !g.dormant &&
                  (hidden > 0 || idleOpen.has(g.key)) &&
                  idleWins.length > 0 && (
                    <div className="row fold-row">
                      <button
                        className="row-label fold-label"
                        onClick={() => toggleIdle(g.key)}
                        title="シェルしか動いていないウィンドウ"
                      >
                        <span className="fold-twisty">{hidden > 0 ? '▸' : '▾'}</span>
                        {hidden > 0 ? `未使用 ${hidden} 枚` : '未使用を畳む'}
                      </button>
                      {canClean > 0 && (
                        <div className="row-tools">
                          <button
                            className="danger text"
                            title={`このプロジェクトの未使用ウィンドウ ${canClean} 枚を閉じる`}
                            onClick={() => cleanUp(g.wins, `「${g.name}」の`)}
                          >
                            片付ける
                          </button>
                        </div>
                      )}
                    </div>
                  )}
              </>
            );
          })()}
      </div>
    );
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

        {/* 全体の要約。押すとその状態で絞り込む。畳んだグループの中身も数に入る */}
        {overall.all.length > 0 && (
          <div className="overview">
            {STATUS_ORDER.filter((k) => overall.counts[k]).map((k) => (
              <button
                key={k}
                className={`ov ${k} ${query === STATUS_TEXT[k] ? 'on' : ''}`}
                title={`「${STATUS_TEXT[k]}」だけを出す`}
                onClick={() => setFilter(query === STATUS_TEXT[k] ? '' : STATUS_TEXT[k])}
              >
                <i />
                {STATUS_TEXT[k]} {overall.counts[k]}
              </button>
            ))}
            {closableAll.length > 0 && (
              <button
                className="ov-clean"
                title={`シェルしか動いていないウィンドウ ${closableAll.length} 枚を閉じる`}
                onClick={() => cleanUp(overall.all, '')}
              >
                片付ける
              </button>
            )}
          </div>
        )}
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

        {liveGroups.map(groupBlock)}

        {restGroups.length > 0 && (
          <div className="rest">
            <button
              className="rest-head"
              onClick={() => setRestOpen((v) => !v)}
              title="ウィンドウが全部未使用（シェルだけ）のプロジェクト"
            >
              <span className="fold-twisty">{restOpen || query ? '▾' : '▸'}</span>
              動いていないプロジェクト
              <span className="rest-count">
                {restGroups.length} 件 · {restGroups.reduce((n, g) => n + g.wins.length, 0)} 枚
              </span>
            </button>
            {(restOpen || query) && restGroups.map(groupBlock)}
          </div>
        )}
      </nav>

      <HoverPreview target={preview} />

      <footer className="sidebar-foot">
        <span>{serverVersion ?? ''}</span>
      </footer>
    </aside>
  );
}
