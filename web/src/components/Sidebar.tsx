import { deviceOf, type Device } from '../devices';
import { Icon } from './Icon';
import { useMemo, useRef, useState } from 'react';
import { HoverPreview, PeekSheet, type PreviewTarget } from './HoverPreview';
import type { DragPayload } from './SplitView';
import type { MenuEntry } from './ContextMenu';
import { buildMenu, type CommandContext, type ListContext, type RowContext } from '../commands';
import { DEVICE_MENU, LIST_MENU, ROW_MENU } from '../menus';
import { useLongPress } from '../hooks/useLongPress';
import {
  STATUS_ORDER,
  STATUS_TEXT,
  isAgentKind,
  summarize,
  type StatusKind,
  type WindowStatus,
} from '../status';
import { shortPath, tildePath } from '../paths';
import { groupProjectWindows, type WindowView, type ProjectWindowGroup } from '../windows';
import type { Session, TmuxWindow } from '../types';

/**
 * これより最近に出力があった未使用ウィンドウは、まとめて閉じる対象から外す。
 * 開いたばかりでまだ何も打っていないウィンドウを巻き込まないため
 */
export const RECENT_IDLE_MS = 10 * 60_000;

/** 一覧の並べ方。プロジェクト = 作業ディレクトリのリポジトリ単位 */
export type GroupBy = 'project' | 'session';

/**
 * まとめて閉じてよいウィンドウか。シェルしかいないと確かめられたものに限り、
 * 開いたばかり（直近に出力あり）のものと、見ている・タブで開いている（pinned）ものは残す
 */
export function isClosable(win: TmuxWindow, views: Map<string, WindowView>, pinned: boolean): boolean {
  const st = views.get(win.id)?.status;
  return Boolean(st?.vacant) && !pinned && (st?.idleFor ?? 0) >= RECENT_IDLE_MS;
}

/** 未使用の端末をまとめて片付ける前の確認。scope は「「atlas-web」の」のような前置き */
export function confirmCleanUp(
  wins: TmuxWindow[],
  scope: string,
  views: Map<string, WindowView>,
  pinned: (win: TmuxWindow) => boolean,
  onConfirm: (message: string, detail: string, run: () => void, opts?: { confirmLabel?: string }) => void,
  onAction: (action: string, params: Record<string, unknown>) => void,
) {
  const targets = wins.filter(w => isClosable(w, views, pinned(w)));
  if (targets.length === 0) return;
  const kept = wins.filter(w => (views.get(w.id)?.status.kind ?? 'idle') === 'idle' && !isClosable(w, views, pinned(w))).length;
  onConfirm(
    `${scope}未使用の端末を ${targets.length} 枚片付けますか？`,
    'シェルしか動いていない端末だけを終了します。画面の履歴は残りません。\n' +
      `タブで開いているもの・直近 ${RECENT_IDLE_MS / 60_000} 分に出力があったもの` +
      `${kept ? `（${kept} 枚）` : ''}は残します。\n` +
      '終了する直前にもう一度プロセスを確かめ、その間に何か動き出したものは残します。',
    () => onAction('killIdleWindows', { targets: targets.map((w) => w.id) }),
    { confirmLabel: '片付ける' },
  );
}

interface Props {
  devices: Device[];
  selectedDevice: string;
  onSelectDevice(id: string): void;
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
  onChangeGroupBy(next: GroupBy): void;
  onSelectSession(id: string): void;
  onSelectWindow(win: TmuxWindow): void;
  /** 端末を開いて、入力先のパネルの隣に並べる（ドラッグで端末の端に落としたときと同じ） */
  onOpenWindowSide(win: TmuxWindow, side: 'right' | 'bottom'): void;
  onAction(action: string, params: Record<string, unknown>): void;
  /** 端末を終了する（確認してから） */
  onKillWindow(win: TmuxWindow): void;
  onClose(): void;
  width: number;
  onResize(width: number): void;
  onConfirm(message: string, detail: string, run: () => void, opts?: { confirmLabel?: string; danger?: boolean }): void;
  /** メニューを開く。中身はここで作る（ContextMenu は App が 1 つだけ持つ） */
  onOpenMenu(items: MenuEntry[], anchor: { x: number; y: number }, title: string): void;
  /** そのデバイスを対象にした app と create の文脈（デバイス見出しの『ここで新規 ▸』と『表示と接続…』に使う） */
  menuContext(deviceId: string): CommandContext;
  /** 見出しの『＋ 新規 ▾』。選択中のデバイスの新規メニューを開く */
  onNewMenu(deviceId: string, anchor: { x: number; y: number }): void;
  onOpenScreen(deviceId: string): void;
  onManageDevices(): void;
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
  devices, selectedDevice, onSelectDevice,
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
  onChangeGroupBy,
  onSelectSession,
  onSelectWindow,
  onOpenWindowSide,
  onAction,
  onKillWindow,
  onClose,
  width,
  onResize,
  onConfirm,
  onOpenMenu,
  menuContext,
  onNewMenu,
  onOpenScreen,
  onManageDevices,
  onStartDrag,
  onDropInTree,
  drag,
  draggingWindowId,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** 畳んでいるデバイス見出し */
  const [collapsedDevices, setCollapsedDevices] = useState<Set<string>>(new Set());
  /** 行メニューの『のぞく』で出しているシート */
  const [peek, setPeek] = useState<Omit<PreviewTarget, 'anchor'> | null>(null);
  const [renaming, setRenaming] = useState<{ kind: 'session' | 'window'; id: string } | null>(
    null,
  );
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('');
  /** 未使用の行を広げているグループ。既定は畳む */
  const [idleOpen, setIdleOpen] = useState<Set<string>>(new Set());
  /** 一覧の末尾の「動いていないプロジェクト」を広げているか */
  const [restOpen, setRestOpen] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

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

  /** プレビューに出す中身（ホバーと『のぞく』で共通） */
  const previewOf = (win: TmuxWindow | null, label: string): Omit<PreviewTarget, 'anchor'> | null => {
    const pane = win ? views.get(win.id)?.lead : null;
    if (!win || !pane) return null;
    const d = describe(win);
    return {
      paneId: pane.id,
      title: d.primary || label,
      subtitle: [label, views.get(win.id)?.where, d.status?.label].filter(Boolean).join(' · '),
    };
  };

  const hoverPreview = (e: React.PointerEvent, win: TmuxWindow | null, label: string) => {
    if (e.pointerType !== 'mouse' || drag) return;
    const target = previewOf(win, label);
    setPreview(target ? { ...target, anchor: e.currentTarget.getBoundingClientRect() } : null);
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
    if (e.pointerType !== 'mouse' || e.button !== 0 || (e.target as HTMLElement).closest('input, .row-more, .twisty, .duplicate-task-toggle')) return;
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
    // リモートデスクトップのタブは tmux のウィンドウではないので、ツリーには落とせない
    if (!drag || drag.kind === 'screen' || !treeDrops || deviceOf(drag.sessionId) !== deviceOf(t.sessionId)) return false;
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
  const closable = (win: TmuxWindow) => isClosable(win, views, pinned(win));

  const cleanUp = (wins: TmuxWindow[], scope: string) =>
    confirmCleanUp(wins, scope, views, pinned, onConfirm, onAction);

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
      devices.find(d => d.id === deviceOf(win.id))?.name,
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
    const source = groupBy === 'project' ? [...new Map(windows.map(win => [win.id, win])).values()] : windows;
    const visible = source.filter(matches);

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
      const groupKey = `${deviceOf(win.id)}:${root}`;
      let g = byRoot.get(groupKey);
      if (!g) {
        byRoot.set(
          groupKey,
          (g = {
            key: groupKey,
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

  const allWindows = useMemo(() => [...new Map(windows.map(w => [w.id, w])).values()], [windows]);
  const closableAll = allWindows.filter(closable);

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
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
      <span key={k} className={`tally ${k}`} title={`${STATUS_TEXT[k]} ${counts[k]} 件`}>
        <i />
        {counts[k]}
      </span>
    ));
  };

  // ------------------------------------------------------------------ メニュー

  /** 同じデバイスの、自分以外のセッション（移す先・まとめる先） */
  const otherSessions = (sessionId: string) =>
    sessions
      .filter((s) => s.id !== sessionId && deviceOf(s.id) === deviceOf(sessionId))
      .map((s) => ({ id: s.id, name: s.name }));

  /** 行メニューの対象 */
  type RowTarget = { kind: 'window'; g: Group; win: TmuxWindow } | { kind: 'group'; g: Group };

  const rowContext = (t: RowTarget): RowContext => {
    if (t.kind === 'window') {
      const { win, g } = t;
      const target = previewOf(win, g.name);
      return {
        kind: 'window',
        name: describe(win).primary,
        open: () => onSelectWindow(win),
        openSide: (side) => onOpenWindowSide(win, side),
        peek: target ? () => { setPreview(null); setPeek(target); } : undefined,
        rename: () => startRename('window', win.id, win.name),
        sessions: otherSessions(win.sessionId),
        moveTo: (sessionId) =>
          onDropInTree({ kind: 'session', sessionId }, { kind: 'window', sessionId: win.sessionId, windowId: win.id, label: describe(win).primary }),
        closable: 0,
        kill: () => onKillWindow(win),
      };
    }
    const { g } = t;
    const session = g.session;
    const headSessionId = session?.id ?? g.wins[0]?.sessionId ?? null;
    const lead = session ? activeWindowOf(session) : g.wins[0] ?? null;
    const target = previewOf(lead, g.name);
    return {
      kind: session ? 'session' : 'project',
      name: g.name,
      open: () => {
        if (session) onSelectSession(session.id);
        else if (g.wins[0]) onSelectWindow(g.wins[0]);
      },
      peek: target ? () => { setPreview(null); setPeek(target); } : undefined,
      newTerminal: headSessionId
        ? () => onAction('newWindow', { target: headSessionId, ...(g.cwd ? { cwd: g.cwd } : {}) })
        : undefined,
      rename: session ? () => startRename('session', session.id, session.name) : undefined,
      sessions: session ? otherSessions(session.id) : [],
      mergeInto: session
        ? (sessionId) => onDropInTree({ kind: 'session', sessionId }, { kind: 'session', sessionId: session.id, windowId: null, label: session.name })
        : undefined,
      closable: g.wins.filter(closable).length,
      cleanUp: () => cleanUp(g.wins, `「${g.name}」の`),
      kill: session
        ? () =>
            onConfirm(
              `tmux セッション「${session.name}」を終了しますか？`,
              `${session.windows} 個の端末と、その中で動いているプロセスがすべて終了します。`,
              () => onAction('killSession', { target: session.id }),
              { confirmLabel: '終了する' },
            )
        : undefined,
    };
  };

  const openRowMenu = (t: RowTarget, anchor: { x: number; y: number }) => {
    setPreview(null);
    const row = rowContext(t);
    onOpenMenu(buildMenu(ROW_MENU, { row }), anchor, row.name);
  };

  /** ボタンの左下にメニューを開く（⋯ とキーボードから） */
  const below = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.bottom };
  };

  const rowPress = useLongPress<RowTarget>((t, point) => openRowMenu(t, point), {
    // 行の中のボタン（同名の切り替え・⋯・畳む）を押したときは長押しにしない
    canStart: (e) => !(e.target as HTMLElement).closest('input, .row-more, .twisty, .duplicate-task-toggle'),
  });

  /** 行の右クリック・長押し・Shift+F10 で行メニューを開く。pointer のハンドラーはドラッグのものと合わせる */
  const rowMenuHandlers = (t: RowTarget) => {
    const press = rowPress.bind(t);
    return {
      press,
      onContextMenu: (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('input')) return;
        e.preventDefault();
        // タッチの長押しは useLongPress が開く（Android は長押しでも contextmenu を出す）
        if ((e.nativeEvent as PointerEvent).pointerType === 'touch') return;
        openRowMenu(t, { x: e.clientX, y: e.clientY });
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
          e.preventDefault();
          openRowMenu(t, below(e.currentTarget));
        }
      },
    };
  };

  const moreButton = (t: RowTarget, name: string) => (
    <button
      className="row-more"
      aria-label={`「${name}」の操作`}
      title={`「${name}」の操作`}
      aria-haspopup="menu"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => openRowMenu(t, below(e.currentTarget))}
    >
      <Icon name="more" />
    </button>
  );

  const listContext: ListContext = {
    groupBy,
    setGroupBy: onChangeGroupBy,
    closable: closableAll.length,
    cleanUp: () => cleanUp(allWindows, ''),
    collapseAll: () => {
      setCollapsed(new Set(groups.map((g) => g.key)));
      setRestOpen(false);
    },
    expandAll: () => {
      setCollapsed(new Set());
      setCollapsedDevices(new Set());
    },
    anyCollapsed: collapsed.size > 0 || collapsedDevices.size > 0,
    manageDevices: onManageDevices,
    close: onClose,
  };

  const openListMenu = (anchor: { x: number; y: number }) => {
    const ctx = menuContext(selectedDevice);
    onOpenMenu(buildMenu(LIST_MENU, { app: ctx.app, list: listContext }), anchor, '一覧');
  };

  const openDeviceMenu = (device: Device, anchor: { x: number; y: number }) => {
    const ctx = menuContext(device.id);
    onOpenMenu(
      buildMenu(DEVICE_MENU, {
        ...ctx,
        device: {
          id: device.id,
          name: device.name,
          connected: !!device.connected,
          selected: device.id === selectedDevice,
          select: () => onSelectDevice(device.id),
          openScreen: () => onOpenScreen(device.id),
          manage: onManageDevices,
        },
      }),
      anchor,
      device.name,
    );
  };

  const toggleDevice = (id: string) =>
    setCollapsedDevices((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // ------------------------------------------------------------------ 行

  const windowRow = (g: Group, win: TmuxWindow, task?: ProjectWindowGroup) => {
    const winActive = win.id === activeWindowId;
    const opened = openSet.has(win.id);
    const d = describe(win);
    const st = d.status;
    const kind: StatusKind = st?.kind ?? 'idle';
    const target: RowTarget = { kind: 'window', g, win };
    const menu = rowMenuHandlers(target);
    return (
      <div
        key={`${g.key}:${win.id}`}
        data-window-id={win.id}
        className={`row window-row st-${kind} ${winActive ? 'active' : ''} ${
          opened && !winActive ? 'opened' : ''
        } ${draggingWindowId === win.id ? 'dragging' : ''} ${dropClass({
          kind: 'window',
          windowId: win.id,
          sessionId: win.sessionId,
          place: 'before',
        })}`}
        onPointerDown={(e) => {
          menu.press.onPointerDown?.(e as React.PointerEvent<HTMLElement>);
          armDrag(e, {
            kind: 'window',
            sessionId: win.sessionId,
            windowId: win.id,
            label: d.primary,
          });
        }}
        onPointerMove={(e) => {
          menu.press.onPointerMove?.(e as React.PointerEvent<HTMLElement>);
          hoverRow(e, {
            kind: 'window',
            windowId: win.id,
            sessionId: win.sessionId,
            place: 'before',
          });
        }}
        onPointerEnter={(e) => hoverPreview(e, win, g.name)}
        onPointerUp={(e) => {
          menu.press.onPointerUp?.(e as React.PointerEvent<HTMLElement>);
          dropRow({
            kind: 'window',
            windowId: win.id,
            sessionId: win.sessionId,
            place: 'before',
          });
        }}
        onPointerCancel={menu.press.onPointerCancel}
        onPointerLeave={menu.press.onPointerLeave}
        onClickCapture={menu.press.onClickCapture}
        onContextMenu={menu.onContextMenu}
        onKeyDown={menu.onKeyDown}
        title={
          drag && treeDrops
            ? 'ここに落とすとこの位置に差し込まれます'
            : 'クリックでタブに開く。右クリック・長押しで操作。ドラッグ：タブ列に落とすと差し込み、端末の端なら画面分割、別のセッション行なら移動'
        }
      >
          {task && task.others.length > 0 && <button className="badge duplicate-task-toggle"
            aria-label={`同じタイトルの端末 ${task.others.length + 1} 件を${expandedTasks.has(task.key) ? '畳む' : '表示'}`}
            aria-expanded={expandedTasks.has(task.key)}
            title={`同じタイトルの端末が${task.others.length + 1}件あります。クリックして個別に選択できます。`}
            onPointerDown={event => event.stopPropagation()}
            onClick={() => setExpandedTasks(prev => {
              const next = new Set(prev);
              next.has(task.key) ? next.delete(task.key) : next.add(task.key);
              return next;
            })}>{expandedTasks.has(task.key) ? '▾' : '▸'} 同名 {task.others.length + 1}</button>}

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
              {opened && <span className="sub-open" title="タブで開いています。選ぶとそのタブに移ります"> · タブで開いている</span>}
              {d.secondary && <span className="sub-rest"> · {d.secondary}</span>}
            </span>
          </button>
        )}

        <span className="win-flags">
          {win.panes > 1 && <span className="badge" title={`ペインが ${win.panes} 個あります`}>{win.panes}p</span>}
          {win.zoomed && <span className="badge zoom" title="ペインを拡大中（tmux）">Z</span>}
          {win.bell && <span className="badge bell" title="ベルが鳴りました">!</span>}
          {win.activity && !winActive && (
            <span className="badge act" title="新しい出力があります">
              ●
            </span>
          )}
        </span>

        {moreButton(target, d.primary)}
      </div>
    );
  };

  const groupBlock = (g: Group) => {
    const isOpen = Boolean(query) || !collapsed.has(g.key);
    const session = g.session;
    const isActive = session
      ? session.id === activeSessionId
      : g.wins.some((w) => w.id === activeWindowId);
    const target: RowTarget = { kind: 'group', g };
    const menu = rowMenuHandlers(target);

    return (
      <div key={g.key} className={`tree-session ${isActive ? 'active' : ''}`}>
        <div
          className={`row session-row ${
            session ? dropClass({ kind: 'session', sessionId: session.id }) : ''
          } ${
            drag?.kind === 'session' && session && drag.sessionId === session.id ? 'dragging' : ''
          }`}
          onPointerDown={(e) => {
            menu.press.onPointerDown?.(e as React.PointerEvent<HTMLElement>);
            if (session)
              armDrag(e, {
                kind: 'session',
                sessionId: session.id,
                windowId: null,
                label: session.name,
              });
          }}
          onPointerMove={(e) => {
            menu.press.onPointerMove?.(e as React.PointerEvent<HTMLElement>);
            if (session) hoverRow(e, { kind: 'session', sessionId: session.id });
          }}
          onPointerEnter={(e) => session && hoverPreview(e, activeWindowOf(session), session.name)}
          onPointerUp={(e) => {
            menu.press.onPointerUp?.(e as React.PointerEvent<HTMLElement>);
            if (session) dropRow({ kind: 'session', sessionId: session.id });
          }}
          onPointerCancel={menu.press.onPointerCancel}
          onPointerLeave={menu.press.onPointerLeave}
          onClickCapture={menu.press.onClickCapture}
          onContextMenu={menu.onContextMenu}
          onKeyDown={menu.onKeyDown}
          title={
            session
              ? drag
                ? 'ここに落とすとこのセッションへ移ります'
                : '右クリック・長押しで操作。ドラッグして別のセッションに重ねるとひとつにまとまります'
              : g.hint
          }
        >
          <button
            className="twisty"
            aria-label={isOpen ? '畳む' : '開く'}
            aria-expanded={isOpen}
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
                {session && session.attached > 0 && <span className="badge attached" title="tmux のクライアントが接続しています">接続中</span>}
              </span>
            </button>
          )}

          {moreButton(target, g.name)}
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
            return (
              <>
                {session || query ? shown.map(win => windowRow(g, win)) :
                  groupProjectWindows(shown, views, activeWindowId, openSet).flatMap(task => [
                    windowRow(g, task.window, task),
                    ...(expandedTasks.has(task.key) ? task.others.map(win => windowRow(g, win)) : []),
                  ])}
                {!query &&
                  !g.dormant &&
                  (hidden > 0 || idleOpen.has(g.key)) &&
                  idleWins.length > 0 && (
                    <div className="row fold-row">
                      <button
                        className="row-label fold-label"
                        aria-expanded={hidden === 0}
                        onClick={() => toggleIdle(g.key)}
                        title="シェルしか動いていない端末。片付けはグループの ⋯ から"
                      >
                        <span className="fold-twisty">{hidden > 0 ? '▸' : '▾'}</span>
                        {hidden > 0 ? `未使用 ${hidden} 枚` : '未使用を畳む'}
                      </button>
                    </div>
                  )}
              </>
            );
          })()}
      </div>
    );
  };

  const selected = devices.find((d) => d.id === selectedDevice) ?? devices[0];

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="filter-wrap">
          <Icon name="search" />
          <input
            className="sidebar-filter"
            aria-label="一覧を絞り込む"
            placeholder="絞り込み…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filter) {
                e.stopPropagation();
                setFilter('');
              }
            }}
          />
          {filter && (
            <button className="filter-clear" aria-label="絞り込みを消す" title="絞り込みを消す" onClick={() => setFilter('')}>
              <Icon name="close" />
            </button>
          )}
        </div>
        <div className="sidebar-head-row">
          <button
            className="btn sidebar-new"
            aria-haspopup="menu"
            disabled={!selected}
            onClick={(e) => selected && onNewMenu(selected.id, below(e.currentTarget))}
          >
            <span aria-hidden="true">＋</span> 新規 <Icon name="chevron-down" />
          </button>
          <button
            className="icon-btn sidebar-menu"
            aria-label="一覧の操作"
            title="一覧の操作"
            aria-haspopup="menu"
            onClick={(e) => openListMenu(below(e.currentTarget))}
          >
            <Icon name="more" />
          </button>
          <button className="icon-btn sidebar-close" aria-label="一覧を閉じる" title="一覧を閉じる (Alt+B)" onClick={onClose}><Icon name="close" /></button>
        </div>
      </div>

      <nav
        className={`tree ${drag && treeDrops ? 'dropping' : ''}`}
        aria-label="一覧"
        onPointerLeave={() => {
          setDropAt(null);
          setPreview(null);
        }}
        onScroll={() => setPreview(null)}
      >
        {groups.length === 0 && (
          <p className="empty">
            {query ? (
              <>「{filter}」に一致する端末はありません。</>
            ) : unauthorized ? (
              <>
                Tailscale認証を確認してください。
                <br />
                Tailscaleに接続し、このPCのTailscale Serve URLで開いてください。
              </>
            ) : !connected ? (
              <>接続しています…</>
            ) : (
              <>
                端末がありません。
                <br />
                上の「＋ 新規」から端末やプロジェクトを作れます。
              </>
            )}
          </p>
        )}

        {devices.map(device => {
          const belongs = (g: Group) => deviceOf(g.session?.id ?? g.wins[0]?.sessionId) === device.id;
          const live = liveGroups.filter(belongs);
          const rest = restGroups.filter(belongs);
          const isSelected = device.id === selectedDevice;
          const open = Boolean(query) || !collapsedDevices.has(device.id);
          const state = device.connected ? '接続済み' : device.error ? '切断' : '接続中…';
          return <section className={`device-group ${isSelected ? 'selected' : ''}`} key={device.id} aria-label={device.name}>
            <div
              className="device-heading"
              onContextMenu={(e) => { e.preventDefault(); openDeviceMenu(device, { x: e.clientX, y: e.clientY }); }}
            >
              <button
                className="device-toggle"
                aria-expanded={open}
                onClick={() => toggleDevice(device.id)}
                onKeyDown={(e) => {
                  if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
                    e.preventDefault();
                    openDeviceMenu(device, below(e.currentTarget));
                  }
                }}
                title={[device.name, isSelected ? '選択中（新規・プロジェクト・リモートデスクトップの対象）' : '', device.error || device.url || 'このPC'].filter(Boolean).join('\n')}
              >
                <span className="fold-twisty" aria-hidden="true">{open ? '▾' : '▸'}</span>
                <span className={`dot ${device.connected ? 'ok' : 'bad'}`} />
                <strong>{device.name}</strong>
                {isSelected && <><span className="device-check" aria-hidden="true">✓</span><span className="sr-only">選択中</span></>}
                <small>{state}</small>
              </button>
              <button
                className="row-more device-more"
                aria-label={`${device.name} の操作`}
                title={`${device.name} の操作`}
                aria-haspopup="menu"
                onClick={(e) => openDeviceMenu(device, below(e.currentTarget))}
              >
                <Icon name="more" />
              </button>
            </div>
            {open && live.map(groupBlock)}
            {open && rest.length > 0 && <div className="rest">
              <button className="rest-head" aria-expanded={restOpen || !!query} onClick={() => setRestOpen(v => !v)}>
                <span className="fold-twisty">{restOpen || query ? '▾' : '▸'}</span>
                動いていないプロジェクト <span className="rest-count">{rest.length} 件</span>
              </button>
              {(restOpen || query) && rest.map(groupBlock)}
            </div>}
          </section>;
        })}
      </nav>

      <div className="sidebar-resize" role="separator" aria-label="一覧の幅" aria-orientation="vertical"
        aria-valuemin={200} aria-valuemax={600} aria-valuenow={width} tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault(); onResize(width + (e.key === 'ArrowRight' ? 20 : -20));
          }
        }}
        onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const nextWidth = e.clientX - e.currentTarget.parentElement!.getBoundingClientRect().left;
          if (nextWidth < 100) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            onClose();
          } else onResize(nextWidth);
        }}
        onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} />
      <HoverPreview target={preview} />
      {peek && <PeekSheet target={peek} onClose={() => setPeek(null)} />}
    </aside>
  );
}
