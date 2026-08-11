import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { fetchCapture, runAction, useTmuxState } from './api';
import { Sidebar, type TreeDropTarget } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { PaneMap } from './components/PaneMap';
import { KeyBar } from './components/KeyBar';
import { CheatSheet } from './components/CheatSheet';
import { Dialog, type DialogSpec } from './components/Dialog';
import { SplitView, type DragPayload } from './components/SplitView';
import type { TerminalHandle } from './components/Terminal';
import {
  allLeaves,
  findLeaf,
  makeLeaf,
  pruneStale,
  removeLeaf,
  retargetLeaf,
  setRatio,
  splitLeaf,
  type DropSide,
  type LayoutNode,
} from './layout';
import type { TmuxWindow } from './types';

interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'info';
}

function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
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

  const [layout, setLayout] = usePersisted<LayoutNode | null>('tw.layout', null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [mode, setMode] = usePersisted<'mirror' | 'direct'>('tw.mode', 'mirror');
  const [showStatusBar, setShowStatusBar] = usePersisted('tw.statusBar', false);
  // 配置図は既定で畳んでおく。1 ウィンドウ 1 ペインで使うぶんには出番がない。
  // 保存キーを変えてあるのは、既に true が保存されている環境にも新しい既定を効かせるため
  const [showPaneMap, setShowPaneMap] = usePersisted('tw.paneMap2', false);
  const [showKeyBar, setShowKeyBar] = usePersisted('tw.keyBar', true);
  const [fontSize, setFontSize] = usePersisted('tw.fontSize', 13);
  // 狭い画面ではサイドバーが全面を覆ってしまうので、最初は畳んでおく
  const isNarrow = () => window.matchMedia('(max-width: 760px)').matches;
  const [sidebarOpen, setSidebarOpen] = useState(() => !isNarrow());
  const [cheatOpen, setCheatOpen] = useState(false);
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [termStatus, setTermStatus] = useState<{ connected: boolean; message?: string }>({
    connected: false,
  });

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

  // ---------------------------------------------------------------- レイアウト

  // 初期化と、消えたセッションの掃除
  // 一度でもタイルを開いたか。閉じきったあとに勝手に開き直さないための目印
  const opened = useRef(false);
  useEffect(() => {
    if (layout) opened.current = true;
  }, [layout]);

  useEffect(() => {
    if (!state) return;
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
      return makeLeaf(first.id, active?.id ?? null);
    });
  }, [state, sessions, windows, layout, setLayout]);

  const leaves = useMemo(() => (layout ? allLeaves(layout) : []), [layout]);

  /** これから作られる／作ったばかりで、まだ状態に現れていないウィンドウ */
  const pendingWindows = useRef<Set<string>>(new Set());

  // フォーカスが実在するタイルを指すようにする
  useEffect(() => {
    if (focusedId && leaves.some((l) => l.id === focusedId)) return;
    setFocusedId(leaves[0]?.id ?? null);
  }, [leaves, focusedId]);

  // 消えたタイルのハンドルは捨てる
  useEffect(() => {
    const alive = new Set(leaves.map((l) => l.id));
    for (const id of termRefs.current.keys()) {
      if (!alive.has(id)) termRefs.current.delete(id);
    }
  }, [leaves]);

  const focusedLeaf = useMemo(
    () => (layout && focusedId ? findLeaf(layout, focusedId) : null),
    [layout, focusedId],
  );

  const currentWindow = useMemo(
    () => windows.find((w) => w.id === focusedLeaf?.windowId) ?? null,
    [windows, focusedLeaf],
  );
  const currentSession = useMemo(
    () => sessions.find((s) => s.id === focusedLeaf?.sessionId) ?? null,
    [sessions, focusedLeaf],
  );
  const windowPanes = useMemo(
    () =>
      panes
        .filter((p) => p.windowId === focusedLeaf?.windowId)
        .sort((a, b) => a.index - b.index),
    [panes, focusedLeaf],
  );
  const activePane = useMemo(
    () => windowPanes.find((p) => p.active) ?? windowPanes[0] ?? null,
    [windowPanes],
  );

  /**
   * ウィンドウが消えたタイルは閉じる。
   * 別のウィンドウに繋ぎ変えると、閉じたはずの端末の場所に関係ないものが出てきて
   * 紛らわしい。最後の 1 枚だった場合は何も開いていない状態になる。
   */
  useEffect(() => {
    if (!state || !layout) return;
    const live = new Set(windows.map((w) => w.id));
    for (const id of live) pendingWindows.current.delete(id);

    // windowId が無いタイルはセッションのアクティブウィンドウを見るので対象外
    const dead = allLeaves(layout).filter(
      (l) => l.windowId && !live.has(l.windowId) && !pendingWindows.current.has(l.windowId),
    );
    if (dead.length === 0) return;

    setLayout((prev) => {
      let next: LayoutNode | null = prev;
      for (const l of dead) {
        if (!next) break;
        next = removeLeaf(next, l.id);
      }
      return next;
    });
  }, [state, windows, layout, setLayout]);

  const focusedTerm = () => (focusedId ? termRefs.current.get(focusedId) : undefined);

  const registerTerm = useCallback((id: string, handle: TerminalHandle | null) => {
    if (handle) termRefs.current.set(id, handle);
    else termRefs.current.delete(id);
  }, []);

  const handleStatus = useCallback(
    (leafId: string, status: { connected: boolean; message?: string }) => {
      setFocusedId((current) => {
        if (leafId === current) setTermStatus(status);
        return current;
      });
    },
    [],
  );

  // ------------------------------------------------------------------- 操作

  const doAction = useCallback(
    async (action: string, params: Record<string, unknown>) => {
      try {
        await runAction(action as never, params);
        refresh();
      } catch (err) {
        toast(`${action}: ${(err as Error).message}`);
      }
    },
    [refresh, toast],
  );

  /**
   * 「分割」= tmux のペインを増やすのではなく、新しいウィンドウを隣のタイルに開く。
   * Terminator と同じ考え方で、1 ウィンドウ 1 ペインのまま画面だけを割る。
   * tmux のペインとして分割したいときはペイン配置図の各マスから。
   */
  const splitIntoNewWindow = useCallback(
    async (side: 'right' | 'bottom') => {
      const session = focusedLeaf?.sessionId ?? sessions[0]?.id;
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
        const leaf = makeLeaf(session, result);
        setLayout((prev) => {
          if (!prev) return leaf;
          const anchor = focusedId ?? allLeaves(prev)[0]?.id;
          return anchor ? splitLeaf(prev, anchor, side, leaf) : leaf;
        });
        setFocusedId(leaf.id);
        refresh();
      } catch (err) {
        toast(`newWindow: ${(err as Error).message}`);
      }
    },
    [focusedLeaf, focusedId, sessions, activePane, setLayout, refresh, toast],
  );

  /** サイドバーでウィンドウを選ぶ = フォーカス中のタイルの表示を差し替える */
  const selectWindow = useCallback(
    (win: TmuxWindow) => {
      setLayout((prev) => {
        if (!prev) return makeLeaf(win.sessionId, win.id);
        if (!focusedId) return prev;
        return retargetLeaf(prev, focusedId, win.sessionId, win.id);
      });
      if (isNarrow()) setSidebarOpen(false);
      focusedTerm()?.focus();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusedId, setLayout],
  );

  const dropWindow = useCallback(
    (targetLeafId: string, side: DropSide, payload: DragPayload) => {
      setLayout((prev) => {
        if (!prev) return makeLeaf(payload.sessionId, payload.windowId);
        if (side === 'center') {
          return retargetLeaf(prev, targetLeafId, payload.sessionId, payload.windowId);
        }
        const leaf = makeLeaf(payload.sessionId, payload.windowId);
        setFocusedId(leaf.id);
        return splitLeaf(prev, targetLeafId, side, leaf);
      });
    },
    [setLayout],
  );

  const closeTile = useCallback(
    (leafId: string) => {
      setLayout((prev) => (prev ? removeLeaf(prev, leafId) : prev));
    },
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

  const onToggle = useCallback(
    (key: 'mode' | 'showStatusBar' | 'showPaneMap' | 'showKeyBar') => {
      if (key === 'mode') setMode((m) => (m === 'mirror' ? 'direct' : 'mirror'));
      if (key === 'showStatusBar') setShowStatusBar((v) => !v);
      if (key === 'showPaneMap') setShowPaneMap((v) => !v);
      if (key === 'showKeyBar') setShowKeyBar((v) => !v);
    },
    [setMode, setShowStatusBar, setShowPaneMap, setShowKeyBar],
  );

  // ブラウザ側のショートカット（Alt 系は tmux に渡さない）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key >= '1' && e.key <= '9') {
        const list = windows
          .filter((w) => w.sessionId === focusedLeaf?.sessionId)
          .sort((a, b) => a.index - b.index);
        const win = list[Number(e.key) - 1];
        if (win) {
          e.preventDefault();
          selectWindow(win);
        }
      } else if (e.key === 'b') {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      } else if (e.key === '/') {
        e.preventDefault();
        setCheatOpen((v) => !v);
      } else if (e.key === 'w' && focusedId && leaves.length > 1) {
        e.preventDefault();
        closeTile(focusedId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [windows, focusedLeaf, focusedId, leaves.length, selectWindow, closeTile]);

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-hidden'}`}>
      <Sidebar
        sessions={sessions}
        windows={windows}
        panes={panes}
        home={state?.server?.home ?? ''}
        activeSessionId={focusedLeaf?.sessionId ?? null}
        activeWindowId={focusedLeaf?.windowId ?? null}
        openWindowIds={leaves.map((l) => l.windowId)}
        connected={connected}
        unauthorized={unauthorized}
        serverVersion={state?.server?.version}
        onSelectSession={(id) => {
          const first =
            windows.find((w) => w.sessionId === id && w.active) ??
            windows.find((w) => w.sessionId === id);
          if (first) selectWindow(first);
        }}
        onSelectWindow={selectWindow}
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
        <div className="titlebar">
          <button
            className="btn ghost icon"
            title="サイドバーの表示切り替え (Alt+B)"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            ☰
          </button>
          <div className="crumbs">
            {currentSession ? (
              <>
                <span className="crumb strong">{currentSession.name}</span>
                {currentWindow && (
                  <>
                    <span className="sep">/</span>
                    <span className="crumb">
                      {currentWindow.index}:{currentWindow.name}
                    </span>
                  </>
                )}
                {activePane && (
                  <>
                    <span className="sep">/</span>
                    <span className="crumb dim">
                      pane {activePane.index} · {activePane.command}
                    </span>
                  </>
                )}
                {leaves.length > 1 && <span className="tile-count">{leaves.length} 分割</span>}
              </>
            ) : (
              <span className="dim">セッションが選択されていません</span>
            )}
          </div>
          <div className="titlebar-right">
            {termStatus.message && !termStatus.connected && (
              <span className="term-status">{termStatus.message}</span>
            )}
            <span className={`dot ${termStatus.connected ? 'ok' : 'bad'}`} />
          </div>
        </div>

        <Toolbar
          window={currentWindow}
          activePane={activePane}
          mode={mode}
          showStatusBar={showStatusBar}
          showPaneMap={showPaneMap}
          showKeyBar={showKeyBar}
          fontSize={fontSize}
          onAction={doAction}
          onSplitNewWindow={splitIntoNewWindow}
          onToggle={onToggle}
          onFontSize={(d) => setFontSize((f) => Math.min(28, Math.max(8, f + d)))}
          onCopyPane={copyPane}
          onOpenCheatSheet={() => setCheatOpen(true)}
        />

        <div className="workspace">
          <div className="terminal-wrap">
            {layout ? (
              <SplitView
                tree={layout}
                focusedId={focusedId}
                sessions={sessions}
                windows={windows}
                panes={panes}
                mode={mode}
                showStatusBar={showStatusBar}
                fontSize={fontSize}
                drag={drag}
                onFocus={setFocusedId}
                onClose={closeTile}
                onDropWindow={dropWindow}
                onDragEnd={() => setDrag(null)}
                onRatio={(id, r) => setLayout((prev) => (prev ? setRatio(prev, id, r) : prev))}
                onStatus={handleStatus}
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
                    <p>開いているタイルがありません。</p>
                    <p className="dim">左の一覧からウィンドウを選ぶと、ここに出ます。</p>
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

          {showPaneMap && windowPanes.length > 0 && (
            <PaneMap
              window={currentWindow}
              panes={windowPanes}
              onAction={doAction}
              onConfirm={confirmThen}
            />
          )}
        </div>

        {showKeyBar && <KeyBar prefix={prefix} onSend={(d) => focusedTerm()?.send(d)} />}
      </main>

      {cheatOpen && <CheatSheet prefix={prefix} onClose={() => setCheatOpen(false)} />}

      {dialog && <Dialog spec={dialog} onClose={() => setDialog(null)} />}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
