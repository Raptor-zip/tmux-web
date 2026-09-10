import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { fetchCapture, runAction, useTmuxState } from './api';
import { Sidebar, type GroupBy, type TreeDropTarget } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { KeyBar } from './components/KeyBar';
import { CheatSheet } from './components/CheatSheet';
import { Dialog, type DialogSpec } from './components/Dialog';
import { SplitView, type DragPayload, type DropTarget } from './components/SplitView';
import { Switcher, type SwitchItem } from './components/Switcher';
import { ContextMenu, SEP, type MenuEntry } from './components/ContextMenu';
import type { TerminalHandle } from './components/Terminal';
import {
  activateTab,
  activeTab,
  addTab,
  allLeaves,
  allTabs,
  closeTab,
  closeTabs,
  dedupeTabs,
  findByTarget,
  findLeaf,
  findTab,
  makeLeaf,
  makeTab,
  migrate,
  moveTab,
  pruneStale,
  remapByName,
  removeLeaf,
  splitWithTab,
  stampNames,
  setRatio,
  type LayoutNode,
} from './layout';
import { buildWindowViews } from './windows';
import { STATUS_ORDER } from './status';
import type { TmuxWindow } from './types';

interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'info';
}

/**
 * tmux サーバが入れ替わったあと、セッションの顔ぶれが落ち着いたと見なすまでの待ち時間。
 * resurrect の復元は一瞬では終わらないので、途中のスナップショットで判断しない。
 */
const SETTLE_MS = 2500;

/** 落ち着くのを待つ上限。動きが止まらない環境でも、ここまで来たら繋ぎ直す */
const MAX_SETTLE_MS = 15_000;

function usePersisted<T>(key: string, initial: T, revive?: (raw: unknown) => T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      const parsed = JSON.parse(raw) as unknown;
      return revive ? revive(parsed) : (parsed as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* プライベートモードなどでは保存しない */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

export default function App() {
  const { state, connected, unauthorized, refresh } = useTmuxState();

  /** タイル id → ターミナル操作ハンドル。ツールバーやキーバーはフォーカス中のタイルに送る */
  const termRefs = useRef(new Map<string, TerminalHandle>());

  const [layout, setLayout] = usePersisted<LayoutNode | null>('tw.layout', null, migrate);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [mode, setMode] = usePersisted<'mirror' | 'direct'>('tw.mode', 'mirror');
  const [showStatusBar, setShowStatusBar] = usePersisted('tw.statusBar', false);
  const [showKeyBar, setShowKeyBar] = usePersisted('tw.keyBar', true);
  // 一覧はプロジェクト（作業ディレクトリのリポジトリ）単位を既定にする。
  // 1 つのディレクトリに 1 つのエージェント、という使い方に一覧の形を合わせる
  const [groupBy, setGroupBy] = usePersisted<GroupBy>('tw.groupBy', 'project');
  const [fontSize, setFontSize] = usePersisted('tw.fontSize', 13);
  const [lineHeight, setLineHeight] = usePersisted('tw.lineHeight', 1.15);
  // 狭い画面ではサイドバーが全面を覆ってしまうので、最初は畳んでおく
  const isNarrow = () => window.matchMedia('(max-width: 760px)').matches;
  // 開閉は覚えておく。VS Code と同じで、閉じたまま開き直せるほうが自然
  const [sidebarOpen, setSidebarOpen] = usePersisted('tw.sidebar', !isNarrow());
  const [cheatOpen, setCheatOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; leafId: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [termStatuses, setTermStatuses] = useState<
    Record<string, { connected: boolean; message?: string }>
  >({});

  /** 非同期の途中で使う「いまの木」。await のあいだに変わっていることがある */
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const toast = useCallback((text: string, kind: Toast['kind'] = 'error') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  /**
   * 取り返しのつかない操作の確認。ブラウザ標準の confirm() は使わない。
   * 既定は削除向けの見た目。まとめる等の非破壊な操作は opts で文言を変える。
   */
  const confirmThen = useCallback(
    (
      title: string,
      detail: string,
      run: () => void,
      opts?: { confirmLabel?: string; danger?: boolean },
    ) => {
      setDialog({
        kind: 'confirm',
        title,
        detail,
        danger: opts?.danger ?? true,
        confirmLabel: opts?.confirmLabel,
        onSubmit: run,
      });
    },
    [],
  );

  const sessions = state?.sessions ?? [];
  const windows = state?.windows ?? [];
  const panes = state?.panes ?? [];
  const prefix = state?.server?.prefix ?? 'C-b';
  const home = state?.server?.home ?? '';

  // 「未使用 12分」のような相対時間を、状態が変わらなくても進ませる
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  /** ウィンドウ id → 一覧・タブ・パレットで共通に使う見せ方 */
  const views = useMemo(
    () => buildWindowViews(windows, panes, home, now),
    [windows, panes, home, now],
  );

  // ---------------------------------------------------------------- レイアウト

  /**
   * tmux が動いていない状態。tmux は最後のセッションが消えるとサーバごと終わるので、
   * 「セッションが 0 件」は「まだ繋がっていない」と同じ意味になる。
   *
   * 起動直後はしばらくここを通る。tmux-web は systemd でログインと同時に上がるのに、
   * tmux サーバはユーザーが端末を開くまで起きず、resurrect の復元もそこから始まる
   * （手元では 50 秒ほど空いていた）。この間に「セッションが無い＝全部消えた」と
   * 判断すると、開いていたタブを閉じたうえに localStorage の配置まで空で上書きし、
   * 復元されるはずだった配置がそこで失われる。
   * 消えた・閉じたの後始末は、tmux に繋がっているあいだだけ行う。
   */
  const serverDown = !state || sessions.length === 0;

  /**
   * tmux を再起動したあとの繋ぎ直し。
   *
   * resurrect が構成を復元すると $1 や @3 といった id は全部振り直されるので、
   * 保存した木をそのまま使うと「知らないセッション」扱いで全部畳まれ、
   * 開いていたタブが消えてしまう。サーバが入れ替わったのを見て、
   * そのときだけ名前で繋ぎ直す。同じサーバのまま消えたウィンドウは今まで通り閉じる。
   */
  const [savedPid, setSavedPid] = usePersisted<number | null>('tw.serverPid', null);
  const serverPid = state?.serverPid ?? null;

  /**
   * pid は使い回されることがあり、再起動後にたまたま同じ値になると入れ替わりを見逃す。
   * 覚えている id が 1 つも通じないときも、入れ替わったものとして繋ぎ直す。
   */
  const idsUnknown = useMemo(() => {
    if (serverDown || !layout) return false;
    const list = allTabs(layout);
    return (
      list.length > 0 && list.every(({ tab }) => !sessions.some((s) => s.id === tab.sessionId))
    );
  }, [serverDown, layout, sessions]);
  const needsRemap = !serverDown && (savedPid !== serverPid || idsUnknown);

  /**
   * 復元が落ち着くのを待ってから繋ぎ直す。resurrect はサーバが起きてから数秒かけて
   * セッションとウィンドウを作っていくので、最初のスナップショットで決めると、
   * まだ戻ってきていないタブを「もう無い」と落としてしまう。
   * セッションとウィンドウの顔ぶれが SETTLE_MS のあいだ変わらなければ、復元は済んだとみなす。
   */
  const stateSig = [
    ...sessions.map((s) => `s:${s.name}`),
    // ウィンドウ名は中で動いているコマンドに合わせて変わるので、並びだけを見る
    ...windows.map((w) => `w:${w.sessionId}:${w.index}`),
  ]
    .sort()
    .join('\u0000');
  const [steadySig, setSteadySig] = useState<string | null>(null);
  useEffect(() => {
    if (serverDown) return;
    const t = setTimeout(() => setSteadySig(stateSig), SETTLE_MS);
    return () => clearTimeout(t);
  }, [serverDown, stateSig]);

  const waitingSince = useRef<number | null>(null);
  useEffect(() => {
    if (!needsRemap) {
      waitingSince.current = null;
      return;
    }
    if (waitingSince.current === null) waitingSince.current = Date.now();
    const prev = layoutRef.current;
    // 繋ぎ直すものが無いなら待たない
    if (prev && steadySig !== stateSig && Date.now() - waitingSince.current < MAX_SETTLE_MS) {
      return;
    }

    const next = prev ? remapByName(prev, { sessions, windows }) : prev;

    setLayout(next);
    setSavedPid(serverPid);

    // 繋ぎ直しは再起動のときにしか起きない。黙って形が変わると原因を追えないので知らせる
    if (prev && next !== prev) {
      const before = allTabs(prev).length;
      const after = next ? allTabs(next).length : 0;
      toast(
        after < before
          ? `配置を繋ぎ直しました（${before - after} 枚は戻せませんでした）`
          : '配置を繋ぎ直しました',
        'info',
      );
    }
  }, [
    needsRemap,
    steadySig,
    stateSig,
    serverPid,
    sessions,
    windows,
    setLayout,
    setSavedPid,
    toast,
  ]);

  // 名前は繋ぎ直しの手がかりなので、繋がっているあいだに焼き込んでおく
  useEffect(() => {
    if (serverDown || needsRemap) return;
    setLayout((prev) => (prev ? stampNames(prev, { sessions, windows }) : prev));
  }, [serverDown, needsRemap, sessions, windows, setLayout]);

  // 一度でもタイルを開いたか。閉じきったあとに勝手に開き直さないための目印
  const opened = useRef(false);
  useEffect(() => {
    if (layout) opened.current = true;
  }, [layout]);

  // 初期化と、消えたセッションの掃除
  useEffect(() => {
    // tmux が落ちているあいだは、消えたのかまだ起きていないのか分からない。触らない
    if (serverDown) return;
    // 繋ぎ直しが済むまでは古い id で判定してしまうので触らない
    if (needsRemap) return;
    const valid = new Set(sessions.map((s) => s.id));
    setLayout((prev) => {
      const pruned = prev ? pruneStale(prev, valid) : null;
      if (pruned) return pruned === prev ? prev : pruned;
      // 自分で閉じた／消えた結果として空になったなら、そのままにしておく
      if (opened.current) return null;
      const first = sessions[0];
      if (!first) return null;
      const active =
        windows.find((w) => w.sessionId === first.id && w.active) ??
        windows.find((w) => w.sessionId === first.id);
      return makeLeaf(makeTab(first.id, active?.id ?? null));
    });
  }, [serverDown, needsRemap, sessions, windows, layout, setLayout]);

  const leaves = useMemo(() => (layout ? allLeaves(layout) : []), [layout]);
  const tabs = useMemo(() => (layout ? allTabs(layout) : []), [layout]);

  /** これから作られる／作ったばかりで、まだ状態に現れていないウィンドウ */
  const pendingWindows = useRef<Set<string>>(new Set());

  // フォーカスが実在するタイルを指すようにする
  useEffect(() => {
    if (focusedId && leaves.some((l) => l.id === focusedId)) return;
    setFocusedId(leaves[0]?.id ?? null);
  }, [leaves, focusedId]);

  // 消えたタイルのハンドルと接続状態は捨てる
  useEffect(() => {
    const alive = new Set(leaves.map((l) => l.id));
    for (const id of termRefs.current.keys()) {
      if (!alive.has(id)) termRefs.current.delete(id);
    }
    setTermStatuses((prev) => {
      const keys = Object.keys(prev).filter((id) => !alive.has(id));
      if (keys.length === 0) return prev;
      const next = { ...prev };
      for (const id of keys) delete next[id];
      return next;
    });
  }, [leaves]);

  const focusedLeaf = useMemo(
    () => (layout && focusedId ? findLeaf(layout, focusedId) : null),
    [layout, focusedId],
  );
  const focusedTab = focusedLeaf ? activeTab(focusedLeaf) : null;
  const focusedIdRef = useRef(focusedId);
  focusedIdRef.current = focusedId;

  const currentWindow = useMemo(
    () => windows.find((w) => w.id === focusedTab?.windowId) ?? null,
    [windows, focusedTab],
  );
  const currentSession = useMemo(
    () => sessions.find((s) => s.id === focusedTab?.sessionId) ?? null,
    [sessions, focusedTab],
  );
  const activePane = useMemo(() => {
    const list = panes
      .filter((p) => p.windowId === focusedTab?.windowId)
      .sort((a, b) => a.index - b.index);
    return list.find((p) => p.active) ?? list[0] ?? null;
  }, [panes, focusedTab]);

  /**
   * ウィンドウが消えたタブは閉じる。
   * 別のウィンドウに繋ぎ変えると、閉じたはずの端末の場所に関係ないものが出てきて
   * 紛らわしい。最後の 1 枚だった場合はタイルごと畳まれる。
   */
  useEffect(() => {
    if (serverDown || !layout || needsRemap) return;
    const live = new Set(windows.map((w) => w.id));
    for (const id of live) pendingWindows.current.delete(id);

    // windowId が無いタブはセッションのアクティブウィンドウを見るので対象外
    const dead = tabs
      .filter(
        ({ tab }) =>
          tab.windowId && !live.has(tab.windowId) && !pendingWindows.current.has(tab.windowId),
      )
      .map(({ tab }) => tab.id);
    if (dead.length === 0) return;
    setLayout((prev) => (prev ? closeTabs(prev, dead) : prev));
  }, [serverDown, needsRemap, windows, layout, tabs, setLayout]);

  /**
   * 同じものを映すタブが 2 枚できてしまったら 1 枚に畳む。
   * 選ぶ・落とす経路では作らせないようにしてあるが、tmux 再起動後の繋ぎ直しや
   * 古い localStorage の配置からは出てくる。最後の砦としてここで畳んでおく。
   */
  useEffect(() => {
    setLayout((prev) => (prev ? dedupeTabs(prev, focusedTab?.id) : prev));
  }, [layout, focusedTab, setLayout]);

  /**
   * ブラウザのタブ／ウィンドウ名も、いま見ているプロジェクト名にする。
   * tmux web を複数のウィンドウで開いたとき、タブの並びだけでどれがどれか分かる。
   */
  useEffect(() => {
    const name = activePane?.project?.name;
    document.title = name ? `${name} — tmux web` : 'tmux web';
  }, [activePane]);

  /** 直前に見ていた順。切り替えパレットの並びに使う（ref だと並びが古いまま残る） */
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    const id = focusedTab?.windowId;
    if (!id) return;
    setRecent((prev) => (prev[0] === id ? prev : [id, ...prev.filter((x) => x !== id)].slice(0, 50)));
  }, [focusedTab]);

  const focusedTerm = () => (focusedIdRef.current ? termRefs.current.get(focusedIdRef.current) : undefined);
  /** 新しく開いたタイルはこの時点ではまだ描かれていないので、次のフレームで掴む */
  const focusSoon = (leafId: string) =>
    requestAnimationFrame(() => termRefs.current.get(leafId)?.focus());

  const registerTerm = useCallback((id: string, handle: TerminalHandle | null) => {
    if (handle) termRefs.current.set(id, handle);
    else termRefs.current.delete(id);
  }, []);

  const handleStatus = useCallback(
    (leafId: string, status: { connected: boolean; message?: string }) => {
      setTermStatuses((prev) => ({ ...prev, [leafId]: status }));
    },
    [],
  );

  const termStatus = (focusedId && termStatuses[focusedId]) || { connected: false };

  // ------------------------------------------------------------------- 操作

  const doAction = useCallback(
    async (action: string, params: Record<string, unknown>) => {
      try {
        await runAction(action as never, params);
        // セッションを消したときは、その場でタブも閉じる。最後の 1 つを消すと tmux は
        // サーバごと終わり、以降は「消えた」のか「まだ起きていない」のか区別できない。
        // 消えたものの後始末は、消した本人がここでやる。
        if (action === 'killSession' && typeof params.target === 'string') {
          const target = params.target;
          setLayout((prev) => {
            if (!prev) return prev;
            const ids = allTabs(prev)
              .filter(({ tab }) => tab.sessionId === target)
              .map(({ tab }) => tab.id);
            return ids.length > 0 ? closeTabs(prev, ids) : prev;
          });
        }
        refresh();
      } catch (err) {
        toast(`${action}: ${(err as Error).message}`);
      }
    },
    [refresh, toast, setLayout],
  );

  /** 落とし先のタイル。指定が無ければフォーカス中、それも無ければ先頭 */
  const anchorLeaf = (tree: LayoutNode, leafId?: string | null) =>
    (leafId ? findLeaf(tree, leafId) : null) ??
    (focusedIdRef.current ? findLeaf(tree, focusedIdRef.current) : null) ??
    allLeaves(tree)[0] ??
    null;

  /** タブを 1 枚開く。すでにどこかに出ているなら、そのタブを前面に出すだけ */
  const openTab = useCallback(
    (sessionId: string, windowId: string | null, leafId?: string | null) => {
      const tree = layoutRef.current;
      if (isNarrow()) setSidebarOpen(false);
      if (!tree) {
        const leaf = makeLeaf(makeTab(sessionId, windowId));
        setLayout(leaf);
        setFocusedId(leaf.id);
        focusSoon(leaf.id);
        return;
      }
      const found = findByTarget(tree, sessionId, windowId);
      if (found) {
        setLayout(activateTab(tree, found.tab.id));
        setFocusedId(found.leaf.id);
        focusSoon(found.leaf.id);
        return;
      }
      const anchor = anchorLeaf(tree, leafId);
      if (!anchor) return;
      setLayout(addTab(tree, anchor.id, makeTab(sessionId, windowId)));
      setFocusedId(anchor.id);
      focusSoon(anchor.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setLayout, setSidebarOpen],
  );

  const openWindow = useCallback(
    (win: TmuxWindow) => openTab(win.sessionId, win.id),
    [openTab],
  );

  /** そのタブと同じディレクトリに、新しい tmux ウィンドウを作ってタブで開く */
  const newTerminal = useCallback(
    async (leafId?: string | null) => {
      const tree = layoutRef.current;
      const anchor = tree ? anchorLeaf(tree, leafId) : null;
      const tab = anchor ? activeTab(anchor) : null;
      const session = tab?.sessionId ?? focusedTab?.sessionId ?? sessions[0]?.id;
      if (!session) return;
      const cwd =
        panes.find((p) => p.windowId === tab?.windowId && p.active)?.path ?? activePane?.path;
      try {
        const { result } = await runAction('newWindow', { target: session, after: true, cwd });
        if (!result) return;
        pendingWindows.current.add(result);
        const cur = layoutRef.current;
        const target = cur ? anchorLeaf(cur, anchor?.id) : null;
        if (cur && target) {
          setLayout(addTab(cur, target.id, makeTab(session, result)));
          setFocusedId(target.id);
          focusSoon(target.id);
        } else {
          const leaf = makeLeaf(makeTab(session, result));
          setLayout(leaf);
          setFocusedId(leaf.id);
          focusSoon(leaf.id);
        }
        refresh();
      } catch (err) {
        toast(`newWindow: ${(err as Error).message}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusedTab, sessions, panes, activePane, setLayout, refresh, toast],
  );

  /**
   * 「分割」= tmux のペインを増やすのではなく、新しいウィンドウを隣のタイルに開く。
   * Terminator と同じ考え方で、1 ウィンドウ 1 ペインのまま画面だけを割る。
   */
  const splitIntoNewWindow = useCallback(
    async (side: 'right' | 'bottom') => {
      const session = focusedTab?.sessionId ?? sessions[0]?.id;
      if (!session) return;
      try {
        // 新しい端末は、いま見ているペインと同じディレクトリで開く
        const { result } = await runAction('newWindow', {
          target: session,
          after: true,
          cwd: activePane?.path,
        });
        if (!result) return;
        pendingWindows.current.add(result);
        const tab = makeTab(session, result);
        const cur = layoutRef.current;
        const anchor = cur ? anchorLeaf(cur) : null;
        if (cur && anchor) {
          const { tree: next, leafId } = splitWithTab(cur, anchor.id, side, tab);
          setLayout(next);
          setFocusedId(leafId);
          focusSoon(leafId);
        } else {
          const leaf = makeLeaf(tab);
          setLayout(leaf);
          setFocusedId(leaf.id);
          focusSoon(leaf.id);
        }
        refresh();
      } catch (err) {
        toast(`newWindow: ${(err as Error).message}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusedTab, sessions, activePane, setLayout, refresh, toast],
  );

  const activate = useCallback(
    (tabId: string) => {
      setLayout((prev) => (prev ? activateTab(prev, tabId) : prev));
      const leaf = layoutRef.current ? findTab(layoutRef.current, tabId)?.leaf : null;
      if (leaf) focusSoon(leaf.id);
    },
    [setLayout],
  );

  const closeTabById = useCallback(
    (tabId: string) => setLayout((prev) => (prev ? closeTab(prev, tabId) : prev)),
    [setLayout],
  );

  const closeTile = useCallback(
    (leafId: string) => setLayout((prev) => (prev ? removeLeaf(prev, leafId) : prev)),
    [setLayout],
  );

  /** タブ列や端末に落とされた。ここで動くのはブラウザ側の配置だけで、tmux は触らない */
  const onDrop = useCallback(
    (target: DropTarget, payload: DragPayload) => {
      const tree = layoutRef.current;
      if (!tree) {
        const leaf = makeLeaf(makeTab(payload.sessionId, payload.windowId));
        setLayout(leaf);
        setFocusedId(leaf.id);
        return;
      }
      const open = findByTarget(tree, payload.sessionId, payload.windowId);

      if (target.kind === 'tab') {
        if (open) {
          setLayout(moveTab(tree, open.tab.id, target.leafId, target.before));
        } else {
          setLayout(addTab(tree, target.leafId, makeTab(payload.sessionId, payload.windowId), target.before));
        }
        setFocusedId(target.leafId);
        focusSoon(target.leafId);
        return;
      }

      // 端に落とした = 新しいタイルとして並べる。
      // 1 枚しかないタイルを自分自身の隣に出しても、同じものが並ぶだけなので何もしない
      if (open && open.leaf.id === target.leafId && open.leaf.tabs.length === 1) return;
      const tab = open?.tab ?? makeTab(payload.sessionId, payload.windowId);
      const base = open ? closeTab(tree, tab.id) : tree;
      if (!base) {
        const leaf = makeLeaf(tab);
        setLayout(leaf);
        setFocusedId(leaf.id);
        return;
      }
      const anchor = anchorLeaf(base, target.leafId);
      if (!anchor) return;
      const { tree: next, leafId } = splitWithTab(base, anchor.id, target.side, tab);
      setLayout(next);
      setFocusedId(leafId);
      focusSoon(leafId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setLayout],
  );

  /**
   * サイドバーの木に落とされた。ここだけは表示の付け替えではなく tmux 自体を動かす。
   * セッションをセッションに重ねたときは中身を全部移すので、確認を挟む。
   */
  const dropInTree = useCallback(
    (target: TreeDropTarget, payload: DragPayload) => {
      if (payload.kind === 'session') {
        if (target.kind !== 'session') return;
        const from = sessions.find((s) => s.id === payload.sessionId);
        const to = sessions.find((s) => s.id === target.sessionId);
        if (!from || !to) return;
        confirmThen(
          `「${from.name}」を「${to.name}」にまとめますか？`,
          `${from.windows} 個のウィンドウが「${to.name}」へ移り、「${from.name}」は無くなります。` +
            'プロセスは動いたままです。',
          () => doAction('mergeSession', { source: from.id, target: to.id }),
          { confirmLabel: 'まとめる', danger: false },
        );
        return;
      }

      if (!payload.windowId) return;
      if (target.kind === 'session') {
        doAction('moveWindow', { target: payload.windowId, session: target.sessionId });
      } else {
        doAction('moveWindow', {
          target: payload.windowId,
          anchor: target.windowId,
          place: target.place,
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions],
  );

  /**
   * ドラッグ開始。後始末のリスナはこの場で張る。
   * useEffect に任せると、指を離すのが再描画より速かったときに登録が間に合わず、
   * ドラッグ状態が残ったままになる。
   */
  const startDrag = useCallback((payload: DragPayload) => {
    // ここで同期的に描き直しておく。この関数は pointermove の途中で呼ばれるので、
    // 次に来る pointerup の時点でサイドバーの行が drag を受け取っていないと、
    // 落としたのに何も起きない、という取りこぼしになる
    flushSync(() => setDrag(payload));
    const end = () => {
      setDrag(null);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }, []);

  /** 端末で選択中の文字列をコピーする。右クリックメニューから使う */
  const copySelection = useCallback(async () => {
    const text = focusedTerm()?.getSelection() ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast(`選択した ${text.split('\n').length} 行をコピーしました`, 'info');
    } catch (err) {
      toast(`コピーに失敗: ${(err as Error).message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  /** 画面（スクロールバックを含む）を丸ごとコピーする。選択とは別物だと分かる名前にする */
  const copyPane = useCallback(async () => {
    if (!activePane) return;
    try {
      const { text } = await fetchCapture(activePane.id, 5000, true);
      await navigator.clipboard.writeText(text.replace(/\s+$/, ''));
      toast(`ペイン ${activePane.index} の内容をコピーしました`, 'info');
    } catch (err) {
      toast(`コピーに失敗: ${(err as Error).message}`);
    }
  }, [activePane, toast]);

  const killPane = useCallback(() => {
    if (!activePane) return;
    const last = panes.filter((p) => p.windowId === activePane.windowId).length <= 1;
    confirmThen(
      `ペイン ${activePane.index} を閉じますか？`,
      `${activePane.command} が ${activePane.path} で動いています。` +
        (last ? '\nこのウィンドウ最後のペインなので、ウィンドウごと無くなります。' : ''),
      () => doAction('killPane', { target: activePane.id }),
    );
  }, [activePane, panes, confirmThen, doAction]);

  const killWindow = useCallback(
    (win: TmuxWindow) =>
      confirmThen(
        `ウィンドウ「${win.name}」を閉じますか？`,
        'この中で動いているプロセスはすべて終了します。' +
          '\n（タブだけ閉じたいなら「タブを閉じる」を使ってください）',
        () => doAction('killWindow', { target: win.id }),
      ),
    [confirmThen, doAction],
  );

  /** 端末を右クリックしたときに出す項目。tmux の display-menu の代わり */
  const menuItems = useCallback((): MenuEntry[] => {
    const pane = activePane?.id;
    const win = currentWindow;
    const selection = focusedTerm()?.getSelection().trim() ?? '';
    return [
      // 選択があるときはそれが主役。「本文をコピー」を先頭に置くと、選択したつもりで
      // 画面全体が入ってしまうので、選択の有無で並びと文言を変える
      ...(selection
        ? [
            {
              label: '選択部分をコピー',
              hint: `${selection.split('\n').length} 行`,
              run: copySelection,
            },
            { label: '選択を解除', run: () => focusedTerm()?.clearSelection() },
            SEP,
          ]
        : []),
      { label: '新しい端末をタブで開く', hint: 'Alt+T', run: () => newTerminal(focusedIdRef.current) },
      { label: '左右に分割', hint: '新しいウィンドウ', run: () => splitIntoNewWindow('right') },
      { label: '上下に分割', hint: '新しいウィンドウ', run: () => splitIntoNewWindow('bottom') },
      SEP,
      {
        label: '画面全体をコピー',
        hint: 'スクロールバック込み',
        run: copyPane,
        disabled: !pane,
      },
      {
        label: '貼り付け',
        hint: 'Ctrl+V',
        run: async () => {
          try {
            const text = await navigator.clipboard.readText();
            if (text) focusedTerm()?.send(text);
          } catch {
            toast('クリップボードを読めませんでした（HTTPS で開いてください）');
          }
        },
      },
      SEP,
      {
        label: 'ペインを全画面 / 元に戻す',
        run: () => pane && doAction('zoomPane', { target: pane }),
        disabled: !pane,
      },
      {
        label: 'tmux のペインとして分割（左右）',
        run: () => pane && doAction('splitPane', { target: pane, direction: 'horizontal' }),
        disabled: !pane,
      },
      {
        label: 'tmux のペインとして分割（上下）',
        run: () => pane && doAction('splitPane', { target: pane, direction: 'vertical' }),
        disabled: !pane,
      },
      SEP,
      {
        label: 'タブを閉じる',
        hint: 'Alt+W',
        run: () => focusedTab && closeTabById(focusedTab.id),
        disabled: !focusedTab,
      },
      { label: 'ペインを閉じる…', run: killPane, disabled: !pane },
      {
        label: 'ウィンドウを閉じる…',
        run: () => win && killWindow(win),
        disabled: !win,
      },
    ];
  }, [
    activePane,
    currentWindow,
    focusedTab,
    newTerminal,
    splitIntoNewWindow,
    copyPane,
    copySelection,
    closeTabById,
    killPane,
    killWindow,
    doAction,
    toast,
  ]);

  /** タブを右クリックしたときに出す項目 */
  const openTabMenu = useCallback(
    (tabId: string, x: number, y: number) => {
      const tree = layoutRef.current;
      const found = tree ? findTab(tree, tabId) : null;
      if (!tree || !found) return;
      const { leaf, tab } = found;
      const win = windows.find((w) => w.id === tab.windowId) ?? null;
      const others = leaf.tabs.filter((t) => t.id !== tabId).map((t) => t.id);
      const at = leaf.tabs.findIndex((t) => t.id === tabId);
      const right = leaf.tabs.slice(at + 1).map((t) => t.id);

      setMenu({
        x,
        y,
        items: [
          { label: 'タブを閉じる', hint: 'Alt+W', run: () => closeTabById(tabId) },
          {
            label: '他のタブを閉じる',
            hint: `${others.length} 枚`,
            run: () => setLayout((prev) => (prev ? closeTabs(prev, others) : prev)),
            disabled: others.length === 0,
          },
          {
            label: '右側のタブを閉じる',
            hint: `${right.length} 枚`,
            run: () => setLayout((prev) => (prev ? closeTabs(prev, right) : prev)),
            disabled: right.length === 0,
          },
          SEP,
          {
            label: '右に切り出す',
            hint: '並べて見る',
            run: () => onDrop({ kind: 'split', leafId: leaf.id, side: 'right' }, {
              kind: 'window',
              sessionId: tab.sessionId,
              windowId: tab.windowId,
              label: win?.name ?? '',
              fromTabId: tab.id,
            }),
            disabled: leaf.tabs.length < 2,
          },
          {
            label: '下に切り出す',
            hint: '並べて見る',
            run: () => onDrop({ kind: 'split', leafId: leaf.id, side: 'bottom' }, {
              kind: 'window',
              sessionId: tab.sessionId,
              windowId: tab.windowId,
              label: win?.name ?? '',
              fromTabId: tab.id,
            }),
            disabled: leaf.tabs.length < 2,
          },
          SEP,
          {
            label: 'ウィンドウ名を変更…',
            run: () =>
              win &&
              setDialog({
                kind: 'prompt',
                title: `ウィンドウ「${win.name}」の名前を変える`,
                defaultValue: win.name,
                confirmLabel: '変更',
                onSubmit: (name) =>
                  name.trim() && doAction('renameWindow', { target: win.id, name: name.trim() }),
              }),
            disabled: !win,
          },
          {
            label: 'ウィンドウを閉じる…',
            hint: 'tmux ごと',
            run: () => win && killWindow(win),
            disabled: !win,
          },
        ],
      });
    },
    [windows, closeTabById, setLayout, onDrop, doAction, killWindow],
  );

  /**
   * 行間を増減する。下限は 1.00。
   * xterm は lineHeight < 1 を投げて弾く（文字が上下で重なるため）ので、
   * それより詰めたいときは文字サイズを下げるしかない。
   */
  const onLineHeightStep = useCallback(
    (d: number) => {
      setLineHeight((v) => Math.round(Math.min(2, Math.max(1, v + d)) * 100) / 100);
    },
    [setLineHeight],
  );

  /**
   * ステータスバーの数値をクリックしたときのメニュー。
   * 押すたびに一方向へ動くだけだと小さくできないので、増減とリセットを並べて出す。
   * メニューは上に開くよう、ボタンの上端を基準にする。
   */
  const openStatusMenu = useCallback(
    (e: React.MouseEvent, kind: 'fontSize' | 'lineHeight') => {
      const r = e.currentTarget.getBoundingClientRect();
      const items: MenuEntry[] =
        kind === 'fontSize'
          ? [
              { label: '大きく', hint: '+1px', run: () => setFontSize((f) => Math.min(28, f + 1)) },
              { label: '小さく', hint: '-1px', run: () => setFontSize((f) => Math.max(8, f - 1)) },
              SEP,
              { label: '既定に戻す', hint: '13px', run: () => setFontSize(13) },
            ]
          : [
              { label: '広げる', hint: '+0.05', run: () => onLineHeightStep(0.05) },
              { label: '詰める', hint: '-0.05', run: () => onLineHeightStep(-0.05) },
              SEP,
              { label: '既定に戻す', hint: '1.15', run: () => setLineHeight(1.15) },
            ];
      setMenu({ x: r.left, y: r.top - 8 - items.length * 26, items });
    },
    [setFontSize, setLineHeight, onLineHeightStep],
  );

  const onToggle = useCallback(
    (key: 'mode' | 'showStatusBar' | 'showKeyBar') => {
      if (key === 'mode') setMode((m) => (m === 'mirror' ? 'direct' : 'mirror'));
      if (key === 'showStatusBar') setShowStatusBar((v) => !v);
      if (key === 'showKeyBar') setShowKeyBar((v) => !v);
    },
    [setMode, setShowStatusBar, setShowKeyBar],
  );

  // ------------------------------------------------------------ 切り替え

  /** フォーカス中のタイルのタブを n 枚ぶん送る */
  const stepTab = useCallback(
    (delta: number) => {
      if (!focusedLeaf || focusedLeaf.tabs.length < 2) return;
      const at = focusedLeaf.tabs.findIndex((t) => t.id === focusedLeaf.activeId);
      const next = focusedLeaf.tabs[(at + delta + focusedLeaf.tabs.length) % focusedLeaf.tabs.length];
      if (next) activate(next.id);
    },
    [focusedLeaf, activate],
  );

  /** 切り替えパレットに出す一覧。直前に見ていた順 → 状態の強い順 */
  const switchItems = useMemo<SwitchItem[]>(() => {
    const openIds = new Set(tabs.map((t) => t.tab.windowId).filter(Boolean) as string[]);
    const order = recent;
    return windows
      .map((win) => ({
        view: views.get(win.id)!,
        open: openIds.has(win.id),
        session: win.sessionName,
      }))
      .filter((it) => it.view)
      .sort((a, b) => {
        const ra = order.indexOf(a.view.win.id);
        const rb = order.indexOf(b.view.win.id);
        if (ra !== rb) return (ra < 0 ? Infinity : ra) - (rb < 0 ? Infinity : rb);
        const sa = STATUS_ORDER.indexOf(a.view.status.kind);
        const sb = STATUS_ORDER.indexOf(b.view.status.kind);
        return sa - sb || a.view.project.localeCompare(b.view.project);
      });
  }, [windows, views, tabs, recent]);

  /**
   * ブラウザ側のショートカット。
   *
   * capture 段階で受けるのが肝心。xterm のリスナは補助 textarea に付いていて、
   * bubble で受けると xterm のほうが先に動き、Alt+B が `ESC b` として tmux に
   * 流れてしまう（readline では単語単位のカーソル移動）。ここで捕まえて止める。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      const digit = e.code.startsWith('Digit')
        ? Number(e.code.slice(5))
        : /^[0-9]$/.test(e.key)
          ? Number(e.key)
          : NaN;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      if (digit >= 1 && digit <= 9) {
        const tab = focusedLeaf?.tabs[digit - 1];
        if (tab) {
          stop();
          activate(tab.id);
        }
        return;
      }
      if (digit === 0) {
        const tab = focusedLeaf?.tabs[focusedLeaf.tabs.length - 1];
        if (tab) {
          stop();
          activate(tab.id);
        }
        return;
      }
      if (e.code === 'BracketLeft' || key === '[') {
        stop();
        stepTab(-1);
      } else if (e.code === 'BracketRight' || key === ']') {
        stop();
        stepTab(1);
      } else if (key === 'b') {
        stop();
        setSidebarOpen((v) => !v);
      } else if (key === 'p') {
        stop();
        setSwitcherOpen((v) => !v);
      } else if (key === 't') {
        stop();
        newTerminal(focusedIdRef.current);
      } else if (key === '/') {
        stop();
        setCheatOpen((v) => !v);
      } else if (key === 'w' && focusedTab) {
        stop();
        closeTabById(focusedTab.id);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focusedLeaf, focusedTab, activate, stepTab, newTerminal, closeTabById, setSidebarOpen]);

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-hidden'}`}>
      <nav className="activitybar">
        <button
          className={`act-btn ${sidebarOpen ? 'on' : ''}`}
          title="セッション一覧 (Alt+B)"
          aria-label="セッション一覧の開閉"
          aria-pressed={sidebarOpen}
          onClick={() => setSidebarOpen((v) => !v)}
        >
          ☰
        </button>
        <button
          className={`act-btn ${switcherOpen ? 'on' : ''}`}
          title="ウィンドウを切り替える (Alt+P)"
          aria-label="ウィンドウを切り替える"
          onClick={() => setSwitcherOpen(true)}
        >
          ⇄
        </button>
        <span className="spacer" />
        <button
          className="act-btn"
          title="tmux チートシート (Alt+/)"
          aria-label="tmux チートシート"
          onClick={() => setCheatOpen(true)}
        >
          ？
        </button>
      </nav>

      <Sidebar
        sessions={sessions}
        windows={windows}
        views={views}
        home={home}
        groupBy={groupBy}
        activeSessionId={focusedTab?.sessionId ?? null}
        activeWindowId={focusedTab?.windowId ?? null}
        openWindowIds={tabs.map(({ tab }) => tab.windowId)}
        connected={connected}
        unauthorized={unauthorized}
        serverVersion={state?.server?.version}
        onChangeGroupBy={setGroupBy}
        onSelectSession={(id) => {
          const first =
            windows.find((w) => w.sessionId === id && w.active) ??
            windows.find((w) => w.sessionId === id);
          if (first) openWindow(first);
        }}
        onSelectWindow={openWindow}
        onAction={doAction}
        onNewSession={() =>
          setDialog({
            kind: 'prompt',
            title: '新しいセッションを作る',
            detail: '名前は省略できます（tmux が番号を振ります）。',
            placeholder: 'セッション名',
            confirmLabel: '作成',
            onSubmit: (name) => doAction('newSession', name.trim() ? { name: name.trim() } : {}),
          })
        }
        onConfirm={confirmThen}
        onStartDrag={startDrag}
        onDropInTree={dropInTree}
        drag={drag}
        draggingWindowId={drag?.kind === 'window' ? drag.windowId : null}
      />

      <main className={`main ${drag ? 'dragging' : ''}`}>
        <Toolbar
          session={currentSession}
          window={currentWindow}
          activePane={activePane}
          home={home}
          tileCount={leaves.length}
          tabCount={focusedLeaf?.tabs.length ?? 0}
          mode={mode}
          showStatusBar={showStatusBar}
          showKeyBar={showKeyBar}
          connected={termStatus.connected}
          statusMessage={termStatus.message}
          onAction={doAction}
          onNewTab={() => newTerminal(focusedIdRef.current)}
          onSplitNewWindow={splitIntoNewWindow}
          onToggle={onToggle}
          onCopyPane={copyPane}
          onKillPane={killPane}
          onOpenSwitcher={() => setSwitcherOpen(true)}
          onOpenCheatSheet={() => setCheatOpen(true)}
          onSendCommand={() =>
            activePane &&
            setDialog({
              kind: 'prompt',
              title: `ペイン ${activePane.index} (${activePane.command}) にコマンドを送る`,
              placeholder: 'コマンド',
              confirmLabel: '送信',
              onSubmit: (cmd) =>
                cmd.trim() && doAction('runCommand', { target: activePane.id, command: cmd }),
            })
          }
          onOpenMenu={(items, x, y) => setMenu({ x, y, items })}
        />

        <div className="workspace">
          <div className="terminal-wrap">
            {layout ? (
              <SplitView
                tree={layout}
                focusedId={focusedId}
                sessions={sessions}
                windows={windows}
                views={views}
                mode={mode}
                showStatusBar={showStatusBar}
                fontSize={fontSize}
                lineHeight={lineHeight}
                drag={drag}
                pendingRemap={needsRemap}
                onFocus={setFocusedId}
                onActivateTab={activate}
                onCloseTab={closeTabById}
                onCloseTile={closeTile}
                onNewTab={(leafId) => newTerminal(leafId)}
                onDrop={onDrop}
                onStartDrag={startDrag}
                onDragEnd={() => setDrag(null)}
                onRatio={(id, r) => setLayout((prev) => (prev ? setRatio(prev, id, r) : prev))}
                onStatus={handleStatus}
                onCopied={(text) => {
                  const lines = text.split('\n').length;
                  toast(
                    lines > 1
                      ? `${lines} 行をコピーしました`
                      : `「${text.length > 24 ? text.slice(0, 24) + '…' : text}」をコピーしました`,
                    'info',
                  );
                }}
                onTerminalContextMenu={(leafId, x, y) => {
                  setFocusedId(leafId);
                  setCtxMenu({ x, y, leafId });
                }}
                onTabContextMenu={openTabMenu}
                registerTerm={registerTerm}
              />
            ) : (
              <div className="placeholder">
                {unauthorized ? (
                  <>
                    <p>認証されていません（401）。</p>
                    <p className="dim">
                      サーバは TMUX_WEB_TOKEN を要求しています。
                      <code>?token=...</code> 付きの URL で開き直してください。
                      セッションが消えたわけではありません。
                    </p>
                  </>
                ) : sessions.length > 0 ? (
                  <>
                    <p>開いているタブがありません。</p>
                    <p className="dim">
                      左の一覧から選ぶか、<kbd>Alt</kbd>+<kbd>P</kbd> で切り替えパレットを出します。
                    </p>
                    <button className="btn primary" onClick={() => setSwitcherOpen(true)}>
                      ウィンドウを選ぶ
                    </button>
                  </>
                ) : (
                  <>
                    <p>tmux セッションがありません。</p>
                    <button className="btn primary" onClick={() => doAction('newSession', {})}>
                      セッションを作る
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {showKeyBar && <KeyBar prefix={prefix} onSend={(d) => focusedTerm()?.send(d)} />}
      </main>

      <footer className="statusbar">
        <span className="sb-item">
          {currentSession ? currentSession.name : 'セッションなし'}
          {currentWindow && ` / ${currentWindow.index}:${currentWindow.name}`}
        </span>
        {!connected && <span className="sb-item sb-bad">サーバと切断</span>}
        {termStatus.message && !termStatus.connected && (
          <span className="sb-item">{termStatus.message}</span>
        )}
        <span className="sb-right">
          <button
            className="sb-item"
            title="ウィンドウを切り替える (Alt+P)"
            onClick={() => setSwitcherOpen(true)}
          >
            {tabs.length} タブ{leaves.length > 1 && ` / ${leaves.length} 分割`}
          </button>
          <button
            className="sb-item"
            title="行間を変える"
            onClick={(e) => openStatusMenu(e, 'lineHeight')}
          >
            行間 {lineHeight.toFixed(2)}
          </button>
          <button
            className="sb-item"
            title="文字サイズを変える"
            onClick={(e) => openStatusMenu(e, 'fontSize')}
          >
            {fontSize}px
          </button>
          <button className="sb-item" title="接続モードを切り替える" onClick={() => onToggle('mode')}>
            {mode === 'mirror' ? 'ミラー' : '直接'}
          </button>
          {state?.server?.version && <span className="sb-item">{state.server.version}</span>}
        </span>
      </footer>

      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={menuItems()} onClose={() => setCtxMenu(null)} />
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}

      {switcherOpen && (
        <Switcher
          items={switchItems}
          onPick={openWindow}
          onClose={() => setSwitcherOpen(false)}
        />
      )}

      {cheatOpen && <CheatSheet prefix={prefix} onClose={() => setCheatOpen(false)} />}

      {dialog && <Dialog spec={dialog} onClose={() => setDialog(null)} />}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <button
            key={t.id}
            className={`toast ${t.kind}`}
            title="クリックで閉じる"
            onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
          >
            {t.text}
          </button>
        ))}
      </div>
    </div>
  );
}
