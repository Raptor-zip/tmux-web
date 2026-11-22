import { useWorkspaceStatus, useWorkspaceValue } from './workspace-store';
import { desktopKey, type DesktopLayoutRegistry } from './desktops';
import { Devices } from './components/Devices';
import { DeviceStart } from './components/DeviceStart';
import { deviceOf } from './devices';
import { ProjectStart, ResumeConversation } from './components/ProjectStart';
import { ApprovalDialog, useApproval } from './components/Approval';
import { RemoteControl } from './components/RemoteControl';
import { ScreenViewer } from './components/ScreenViewer';
import { Icon } from './components/Icon';
import { createPortal } from 'react-dom';
import { FileBrowser } from './components/FileBrowser';
import { InputBar, ScreenInputBar } from './components/InputBar';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { fetchCapture, runAction, uploadAttachment, useTmuxState, type StartedProject } from './api';
import { quotePath } from './attachments';
import { Sidebar, confirmCleanUp, isClosable, type GroupBy, type TreeDropTarget } from './components/Sidebar';
import { tabMenuItems, screenMenuItems, NEW_MENU } from './menus';
import { buildMenu, paletteCommands, type AppContext, type CommandContext, type CreateContext, type ListContext, type DesktopContext, type PanelContext, type ScreenContext, type SelectionContext, type TabContext } from './commands';
import { nextInputBar, useAltKeys, useConnectionMode, useFontSize, useInputBar, useLineHeight, useStatusLine } from './shared-setting';
import { requestInstall, takeInstallHint, useInstallState } from './pwa';
import { Dialog, type DialogSpec } from './components/Dialog';
import { SplitView, tabPayload, type DragPayload, type DropTarget } from './components/SplitView';
import { Switcher, type PaletteScope, type PaletteTabGroup, type SwitchItem } from './components/Switcher';
import { Shortcuts } from './components/Shortcuts';
import { TextCopy } from './components/TextCopy';
import { ContextMenu, SEP, type MenuEntry } from './components/ContextMenu';
import { TabSheet } from './components/TabSheet';
import { useLongPress } from './hooks/useLongPress';
import type { TerminalStatus } from './components/Terminal';
import { isTerminalHandle, type TabHandle } from './components/TerminalTabs';
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
  findSameTarget,
  findScreenTab,
  retargetScreenTab,
  isScreenTab,
  isTerminalTab,
  makeScreenTab,
  tabDevice,
  type TabRef,
  type TerminalTab,
  findTab,
  makeLeaf,
  makeTab,
  migrate,
  moveTab,
  pruneStale,
  remapByName,
  removeLeaf,
  sameLayout,
  snapshotLayout,
  undoLayout,
  UNDO_MS,
  type LayoutSnapshot,
  splitWithTab,
  stampNames,
  setRatio,
  stepInOrder,
  visibleTabOrder,
  type LayoutNode,
} from './layout';
import { buildWindowViews, paneCommand, type WindowView } from './windows';
import { nextWaiting, STATUS_ORDER } from './status';
import type { Pane, TmuxWindow } from './types';

interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'info' | 'warn';
  /** aria-live=assertive で読み上げる（承認待ちの検知など） */
  urgent?: boolean;
  /** トーストに添えるボタン（『元に戻す』など） */
  action?: { label: string; run: () => void };
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

/** 承認待ちのトーストを出した依頼。ワークスペースを切り替えても同じ依頼で二度読み上げない */
let announcedApprovalId: string | null = null;

/** 上バーの差し込み口（Desktops.tsx）。表示中のワークスペースだけが受け取る */
export interface BarSlots {
  /** タブ列の左：≡ */
  leading: HTMLElement | null;
  /** 接続状態の左：入力待ち・承認待ち */
  status: HTMLElement | null;
  /** 右端：⌕ 探す・操作 */
  trailing: HTMLElement | null;
  /** スマホの見出し：現在のタブ ▾ n/m（≡ の右） */
  phone?: HTMLElement | null;
  /** スマホの見出しの右端：＋▾ と ⋯ */
  phoneEnd?: HTMLElement | null;
}

/** スマホの見出し 1 行とタブ一覧シートに要るもの（Desktops.tsx から。表示中のワークスペースだけ） */
export interface PhoneHead {
  workspaces: { id: string; name: string }[];
  activeWorkspace: string;
  selectWorkspace(id: string): void;
  openWorkspaceMenu(id: string, x: number, y: number): void;
  /** 接続状態の要約 */
  connection: string;
  connectionBad: boolean;
  openConnection(): void;
}

export default function App({ workspaceId, workspaceName, active, connection, desktopLayouts, onDesktopDrag, desktopTargets, onMoveDesktopTab, barSlots, onOpenSettings, workspace, phone }: {
  workspaceId: string; workspaceName: string; active: boolean; connection: ReturnType<typeof useTmuxState>;
  barSlots?: BarSlots;
  /** スマホの見出し 1 行（タブ列を出さない設定のとき） */
  phone?: PhoneHead;
  /** 『表示と接続』を開く（Desktops.tsx が持つ。設定は全ワークスペースで共通） */
  onOpenSettings?(): void;
  /** 表示中のワークスペースの操作（名前を変更・追加・並べ替え・削除）。パレットの『操作』に出す */
  workspace?: DesktopContext;
  desktopLayouts: DesktopLayoutRegistry;
  desktopTargets: { id: string; name: string }[];
  onMoveDesktopTab(sourceId: string, tabId: string, destinationId: string): void;
  onDesktopDrag(sourceId: string, payload: DragPayload, end: () => void): void;
}) {
  const { state, devices, devicesReady, connected, unauthorized, authUrl, refresh, reloadDevices } = connection;
  const activeRef = useRef(active);
  activeRef.current = active;
  const key = (name: string) => desktopKey(workspaceId, name);
  const [selectedDevice, setSelectedDevice] = useWorkspaceValue(key('tw.device'), 'local');
  const [panelFocus, setPanelFocus] = useState(false);
  /** いま 1 パネル表示か（最大化中、または狭くて自動）。SplitView が知らせる。Alt+数字の数え方が変わる */
  const [singlePanel, setSinglePanel] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const activeDevice = devices.find(d => d.id === selectedDevice) ?? devices[0];
  const device = activeDevice?.server?.device;
  const unavailable = useMemo(() => new Set(devices.filter(d => !d.connected || !d.serverPid).map(d => d.id)), [devices]);
  useEffect(() => {
    if (!active || !device) return;
    document.documentElement.style.removeProperty('--accent');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#1a1b26');
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', device.name);
    // ホスト変更や設定変更の後も同じ URL の古いアイコンを使わせない。
    for (const rel of ['icon', 'apple-touch-icon', 'manifest']) {
      const link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (link) link.href = `${new URL(link.href).pathname}?device=${device.fingerprint}`;
    }
  }, [active, device?.fingerprint]);

  /** タイル id → ターミナル操作ハンドル。ツールバーやキーバーはフォーカス中のタイルに送る */
  const termRefs = useRef(new Map<string, TabHandle>());

  const [layout, setLayout] = useWorkspaceValue<LayoutNode | null>(key('tw.layout'), null, migrate);
  const [focusedId, setFocusedId] = useWorkspaceValue<string | null>(key('tw.focusedLeaf'), null);
  // 『表示と接続』の設定。すべてのワークスペースで同じ値を見る（shared-setting.ts）
  const [mode, setMode] = useConnectionMode();
  const [showStatusBar, setShowStatusBar] = useStatusLine();
  /** 入力行（キー列＋入力）：自動 / 常に表示 / 隠す。旧キーバーの設定を引き継ぐ */
  const [inputBar, setInputBar] = useInputBar();
  /** Alt のショートカットをアプリで受けるか。オフなら Alt キーはすべて端末（readline や TUI）へ届く */
  const [altKeys, setAltKeys] = useAltKeys();
  // 一覧はプロジェクト（作業ディレクトリのリポジトリ）単位を既定にする。
  // 1 つのディレクトリに 1 つのエージェント、という使い方に一覧の形を合わせる
  const [groupBy, setGroupBy] = usePersisted<GroupBy>('tw.groupBy', 'project');
  const [fontSize, setFontSize] = useFontSize();
  const [lineHeight, setLineHeight] = useLineHeight();
  useEffect(() => {
    // 文字サイズは全ワークスペース共通なので、表示中のワークスペースだけがホイールを受ける
    if (!active) return;
    let accumulated = 0;
    let lastTime = 0;
    const onWheel = (event: WheelEvent) => {
      // リモートデスクトップの上では Ctrl+ホイールをリモートへ渡す
      if (!event.ctrlKey || !(event.target instanceof Element) || !event.target.closest('.terminal-wrap')) return;
      // 画面タブではページの拡大だけ抑え、イベントは noVNC（リモート）へそのまま流す
      if (event.target.closest('.screen-tab-view')) { event.preventDefault(); return; }
      // xterm/tmux にスクロールを送らず、ブラウザのページ拡大も抑える。
      event.preventDefault();
      event.stopPropagation();
      if (!event.deltaY) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1);
      const now = performance.now();
      if (now - lastTime > 200 || Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0;
      lastTime = now;
      accumulated += delta;
      // 高精度トラックパッドの微小なイベントで急激に変わらないようにする。
      if (Math.abs(accumulated) < 40) return;
      const step = accumulated < 0 ? 1 : -1;
      accumulated = 0;
      setFontSize(size => Math.min(28, Math.max(6, size + step)));
    };
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => window.removeEventListener('wheel', onWheel, true);
  }, [active, setFontSize]);
  // 狭い画面ではサイドバーが全面を覆ってしまうので、最初は畳んでおく
  const isNarrow = () => window.matchMedia('(max-width: 760px)').matches;
  // 開閉は覚えておく。VS Code と同じで、閉じたまま開き直せるほうが自然
  const [sidebarWidth, setSidebarWidth] = usePersisted('tw.sidebarWidth', 260);
  const [sidebarOpen, setSidebarOpen] = usePersisted('tw.sidebar', !isNarrow());
  const pendingWindows = useRef<Set<string>>(new Set());
  const pendingSessions = useRef<Set<string>>(new Set());
  const [projectMode, setProjectMode] = useState<'new' | 'existing' | null>(null);
  /** 過去の会話を再開（Claude / Codex）のモーダル */
  const [resumeOpen, setResumeOpen] = useState(false);
  const approval = useApproval(active);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const approvalOpen = approvalId !== null && approvalId === approval.pending?.id;
  const openApproval = () => setApprovalId(approval.pending?.id ?? null);
  const [remotePane, setRemotePane] = useState<string | null>(null);
  const [screenOpen, setScreenOpen] = useState<string | null>(null);
  const [filesPaneId, setFilesPaneId] = useState<string | null>(null);
  const [launchingAgent, setLaunchingAgent] = useState<'claude' | 'codex' | null>(null);
  const launchInFlight = useRef(false);
  const latestKeys = useRef<{
    openNewMenuAtStrip(): void;
    launchAgent(agent: 'claude' | 'codex'): void;
    goNextWaiting(): void;
    /** 作業フォルダーを開けたら true。端末のタブでなければ false（キーは端末へ流す） */
    openFiles(): boolean;
  }>({ openNewMenuAtStrip: () => {}, launchAgent: () => {}, goNextWaiting: () => {}, openFiles: () => false });
  /** 開いているパレットのスコープ。null なら閉じている */
  const [palette, setPalette] = useState<PaletteScope | null>(null);
  /** 上バーの『入力待ち N』から開いたとき、パレットの『端末』を入力待ちだけに絞る */
  const [paletteWaiting, setPaletteWaiting] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[]; title?: string } | null>(null);
  /** 『テキストを選んでコピー…』のシートで見せているペイン */
  const [textCopyPane, setTextCopyPane] = useState<Pane | null>(null);
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [termStatuses, setTermStatuses] = useState<
    Record<string, TerminalStatus>
  >({});

  /** 非同期の途中で使う「いまの木」。await のあいだに変わっていることがある */
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useLayoutEffect(() => {
    desktopLayouts.set(workspaceId, {
      read: () => ({ layout: layoutRef.current, focusedId }),
      write: (next, focus) => {
        layoutRef.current = next;
        setLayout(next);
        setFocusedId(focus);
      },
    });
    return () => { desktopLayouts.delete(workspaceId); };
  }, [desktopLayouts, workspaceId, focusedId, setLayout, setFocusedId]);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'error', action?: Toast['action']) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? UNDO_MS : 5000);
    return id;
  }, []);

  /** 承認待ちを初めて検知したら、上バーのチップと一緒に assertive のトーストで知らせる（同じ依頼では 1 回だけ） */
  useEffect(() => {
    const pending = approval.pending;
    if (!active || !pending || announcedApprovalId === pending.id) return;
    announcedApprovalId = pending.id;
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text: `sudo の承認待ち：${pending.cmd}`, kind: 'warn', urgent: true, action: { label: '内容を確認', run: () => setApprovalId(pending.id) } }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 8000);
  }, [active, approval.pending]);

  // 『アプリとして追加』は上バーに置かない。追加できるブラウザでは、初回に一度だけ案内する
  const install = useInstallState();
  useEffect(() => {
    if (!active || install.installed || !install.promptable) return;
    let storage: Storage | null = null;
    try { storage = localStorage; } catch { /* 保存できない環境では案内しない */ }
    if (!takeInstallHint(storage, install)) return;
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text: 'アプリとして追加すると、専用ウィンドウで開けます', kind: 'info',
      action: { label: 'アプリとして追加', run: () => { setToasts((t) => t.filter((x) => x.id !== id)); void requestInstall(); } } }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 10_000);
  }, [active, install]);

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
  const prefix = activeDevice?.server?.prefix ?? 'C-b';
  const home = activeDevice?.server?.home ?? '';

  // 「未使用 12分」のような相対時間を、状態が変わらなくても進ませる
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  /** ウィンドウ id → 一覧・タブ・パレットで共通に使う見せ方 */
  const views = useMemo(
    () => {
      const result = new Map<string, WindowView>();
      for (const d of devices) for (const [id, view] of buildWindowViews(windows.filter(w => deviceOf(w.id) === d.id), panes.filter(p => deviceOf(p.id) === d.id), d.server?.home || '', now)) result.set(id, view);
      return result;
    },
    [windows, panes, devices, now],
  );
  /** 入力待ちの端末（Alt+J で順に回る）。並びは一覧と同じウィンドウ順 */
  const waitingIds = useMemo(
    () => windows.filter(w => views.get(w.id)?.status.kind === 'waiting').map(w => w.id),
    [windows, views],
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
  // An incomplete device list cannot prove that saved remote tabs disappeared.
  const { remoteAt } = useWorkspaceStatus();
  useEffect(() => { if (remoteAt) refresh(); }, [remoteAt]);
  // A layout can arrive before the tmux event stream. Wait for fresh snapshots
  // before pruning its tabs, including snapshots from connected remote devices.
  const syncingState = devices.some(d => d.connected && (d.receivedAt ?? 0) < remoteAt);
  const serverDown = syncingState || !devicesReady || !state || sessions.length === 0;

  /**
   * tmux を再起動したあとの繋ぎ直し。
   *
   * resurrect が構成を復元すると $1 や @3 といった id は全部振り直されるので、
   * 保存した木をそのまま使うと「知らないセッション」扱いで全部畳まれ、
   * 開いていたタブが消えてしまう。サーバが入れ替わったのを見て、
   * そのときだけ名前で繋ぎ直す。同じサーバのまま消えたウィンドウは今まで通り閉じる。
   */
  const [savedPid, setSavedPid] = useWorkspaceValue<string | number | null>(key('tw.serverPid'), null);
  const serverPid = devices.map(d => `${d.id}:${d.serverPid ?? '?'}`).join('|');

  /**
   * pid は使い回されることがあり、再起動後にたまたま同じ値になると入れ替わりを見逃す。
   * 覚えている id が 1 つも通じないときも、入れ替わったものとして繋ぎ直す。
   */
  const idsUnknown = useMemo(() => {
    if (serverDown || !layout) return false;
    // 画面タブは tmux の id を持たないので、入れ替わりの判定には使わない
    const list = allTabs(layout).filter(({ tab }) => isTerminalTab(tab)) as Array<{ tab: TerminalTab }>;
    return (
      list.length > 0 && list.every(({ tab }) => !pendingSessions.current.has(tab.sessionId) && !sessions.some((s) => s.id === tab.sessionId))
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

    const next = prev ? remapByName(prev, { sessions, windows }, unavailable) : prev;

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

  // 消えたセッションを掃除する。空ならデバイス選択から新しい端末を開く。
  useEffect(() => {
    // tmux が落ちているあいだは、消えたのかまだ起きていないのか分からない。触らない
    if (serverDown) return;
    // 繋ぎ直しが済むまでは古い id で判定してしまうので触らない
    if (needsRemap) return;
    for (const session of sessions) pendingSessions.current.delete(session.id);
    const valid = new Set([...sessions.map((s) => s.id), ...pendingSessions.current]);
    setLayout((prev) => {
      const pruned = prev ? pruneStale(prev, valid, unavailable) : null;
      return pruned === prev ? prev : pruned;
    });
  }, [serverDown, needsRemap, sessions, windows, layout, setLayout]);

  const leaves = useMemo(() => (layout ? allLeaves(layout) : []), [layout]);
  const tabs = useMemo(() => (layout ? allTabs(layout) : []), [layout]);


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
  /** 前面のタブが端末ならそのタブ。リモートデスクトップなら null（tmux の操作の対象が無い） */
  const focusedTerminalTab = focusedTab && isTerminalTab(focusedTab) ? focusedTab : null;
  const focusedScreen = !!focusedTab && isScreenTab(focusedTab);
  const focusedDevice = focusedTab ? tabDevice(focusedTab) : null;
  useEffect(() => {
    if (focusedDevice) setSelectedDevice(focusedDevice);
  }, [focusedTab?.id, focusedDevice]);
  const focusedIdRef = useRef(focusedId);
  focusedIdRef.current = focusedId;

  const currentWindow = useMemo(
    () => windows.find((w) => w.id === focusedTerminalTab?.windowId) ?? null,
    [windows, focusedTerminalTab],
  );
  const currentSession = useMemo(
    () => sessions.find((s) => s.id === focusedTerminalTab?.sessionId) ?? null,
    [sessions, focusedTerminalTab],
  );
  const activePane = useMemo(() => {
    if (!focusedTerminalTab) return null;
    const list = panes
      .filter((p) => p.windowId === focusedTerminalTab.windowId)
      .sort((a, b) => a.index - b.index);
    return list.find((p) => p.active) ?? list[0] ?? null;
  }, [panes, focusedTerminalTab]);

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
          isTerminalTab(tab) && tab.windowId && !unavailable.has(deviceOf(tab.sessionId)) && !live.has(tab.windowId) && !pendingWindows.current.has(tab.windowId),
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
    const name = focusedScreen ? 'リモートデスクトップ' : activePane?.project?.name;
    if (!active) return;
    document.title = [workspaceName, name, device?.name].filter(Boolean).join(' — ');
  }, [active, workspaceName, activePane, focusedScreen, device?.name]);

  /** 直前に見ていた順。切り替えパレットの並びに使う（ref だと並びが古いまま残る） */
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    const id = focusedTerminalTab?.windowId;
    if (!id) return;
    setRecent((prev) => (prev[0] === id ? prev : [id, ...prev.filter((x) => x !== id)].slice(0, 50)));
  }, [focusedTerminalTab]);

  /** 前面のタブの端末。リモートデスクトップのタブでは undefined（文字の送信や貼り付けをしない） */
  const focusedTerm = () => {
    const handle = focusedIdRef.current ? termRefs.current.get(focusedIdRef.current) : undefined;
    return isTerminalHandle(handle) ? handle : undefined;
  };
  /** 前面のタブのリモートデスクトップ。入力行の画面用キーと ⌨ はここへ送る */
  const focusedScreenHandle = () => {
    const handle = focusedIdRef.current ? termRefs.current.get(focusedIdRef.current) : undefined;
    return handle && !isTerminalHandle(handle) ? handle : undefined;
  };
  /** 新しく開いたタイルはこの時点ではまだ描かれていないので、次のフレームで掴む */
  const focusSoon = (leafId: string) =>
    requestAnimationFrame(() => { if (activeRef.current) termRefs.current.get(leafId)?.focus(); });

  const registerTerm = useCallback((id: string, handle: TabHandle | null) => {
    if (handle) termRefs.current.set(id, handle);
    else termRefs.current.delete(id);
  }, []);

  const handleStatus = useCallback(
    (leafId: string, status: TerminalStatus) => {
      setTermStatuses((prev) => ({ ...prev, [leafId]: status }));
    },
    [],
  );

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      for (const term of termRefs.current.values()) term.fit();
      if (focusedIdRef.current) termRefs.current.get(focusedIdRef.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  // ------------------------------------------------------------------- 操作

  const doAction = useCallback(
    async (action: string, params: Record<string, unknown>) => {
      try {
        const res = await runAction(action as never, params);
        // まとめて閉じたときは、確認のあとで動き出して残ったぶんがあり得るので実数を出す
        if (action === 'killIdleWindows') {
          toast(`未使用のウィンドウを ${res.result ?? 0} 枚閉じました`, 'info');
        }
        // セッションを消したときは、その場でタブも閉じる。最後の 1 つを消すと tmux は
        // サーバごと終わり、以降は「消えた」のか「まだ起きていない」のか区別できない。
        // 消えたものの後始末は、消した本人がここでやる。
        if (action === 'killSession' && typeof params.target === 'string') {
          const target = params.target;
          setLayout((prev) => {
            if (!prev) return prev;
            const ids = allTabs(prev)
              .filter(({ tab }) => isTerminalTab(tab) && tab.sessionId === target)
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

  /** デバイスのリモートデスクトップをタブで開く。すでに開いていればそれを前に出す */
  const openScreen = useCallback(
    (deviceId: string, leafId?: string | null) => {
      const tree = layoutRef.current;
      if (isNarrow()) setSidebarOpen(false);
      if (!tree) {
        const leaf = makeLeaf(makeScreenTab(deviceId));
        setLayout(leaf);
        setFocusedId(leaf.id);
        focusSoon(leaf.id);
        return;
      }
      const found = findScreenTab(tree, deviceId);
      if (found) {
        setLayout(activateTab(tree, found.tab.id));
        setFocusedId(found.leaf.id);
        focusSoon(found.leaf.id);
        return;
      }
      const anchor = anchorLeaf(tree, leafId);
      if (!anchor) return;
      setLayout(addTab(tree, anchor.id, makeScreenTab(deviceId)));
      setFocusedId(anchor.id);
      focusSoon(anchor.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setLayout, setSidebarOpen],
  );

  const projectStarted = (project: StartedProject) => {
    pendingSessions.current.add(project.sessionId);
    setTimeout(() => { pendingSessions.current.delete(project.sessionId); pendingWindows.current.delete(project.windowId); refresh(); }, 10000);
    pendingWindows.current.add(project.windowId);
    setProjectMode(null);
    setResumeOpen(false);
    openTab(project.sessionId, project.windowId);
    refresh();
  };

  const openWindow = useCallback(
    (win: TmuxWindow) => openTab(win.sessionId, win.id),
    [openTab],
  );

  /** そのタブと同じディレクトリに、新しい tmux ウィンドウを作ってタブで開く */
  const newTerminal = useCallback(
    async (leafId?: string | null, agent?: 'claude' | 'codex', deviceId?: string) => {
      const tree = layoutRef.current;
      const anchor = tree ? anchorLeaf(tree, leafId) : null;
      const anchorTab = anchor ? activeTab(anchor) : null;
      // リモートデスクトップのタブからは、そのデバイスの端末を開く
      const screenDevice = anchorTab && isScreenTab(anchorTab) ? anchorTab.deviceId : null;
      const tab = anchorTab && isTerminalTab(anchorTab) ? anchorTab : null;
      const device = deviceId ?? screenDevice;
      const session = device
        ? sessions.find(s => deviceOf(s.id) === device)?.id
        : tab?.sessionId ?? focusedTerminalTab?.sessionId ?? sessions.find(s => deviceOf(s.id) === activeDevice.id)?.id;
      if (!session && device) { setSelectedDevice(device); setProjectMode('existing'); return; }
      if (!session) { if (deviceId) setSelectedDevice(deviceId); setProjectMode('existing'); return; }
      const cwd =
        device ? undefined : panes.find((p) => p.windowId === tab?.windowId && p.active)?.path ?? activePane?.path;
      try {
        const { result } = await runAction(agent ? 'launchAgent' : 'newWindow', { target: session, after: true, cwd, ...(agent ? { agent } : {}) });
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
        toast(`${agent || "newWindow"}: ${(err as Error).message}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusedTerminalTab, sessions, panes, activePane, activeDevice.id, setLayout, refresh, toast],
  );

  /** deviceId を渡すと、そのデバイスで起動する（一覧のデバイス見出しの『ここで新規 ▸』） */
  const launchAgent = async (agent: 'claude' | 'codex', deviceId?: string) => {
    if (launchInFlight.current) return;
    launchInFlight.current = true;
    setLaunchingAgent(agent);
    try { await newTerminal(focusedIdRef.current, agent, deviceId); }
    finally { launchInFlight.current = false; setLaunchingAgent(null); }
  };

  /**
   * 「分割」= tmux のペインを増やすのではなく、新しいウィンドウを隣のタイルに開く。
   * Terminator と同じ考え方で、1 ウィンドウ 1 ペインのまま画面だけを割る。
   */
  const splitIntoNewWindow = useCallback(
    async (side: 'right' | 'bottom', agent?: 'claude' | 'codex', deviceId?: string) => {
      // deviceId を渡されたら、そのデバイスの端末を開く（入力先とは別のデバイスなら作業フォルダーは引き継がない）
      const other = !!deviceId && deviceId !== focusedDevice;
      // リモートデスクトップを見ているときは、そのデバイスの端末を隣に開く
      const session = other
        ? sessions.find(s => deviceOf(s.id) === deviceId)?.id
        : focusedTerminalTab?.sessionId
          ?? (focusedDevice ? sessions.find(s => deviceOf(s.id) === focusedDevice)?.id : undefined)
          ?? sessions[0]?.id;
      if (!session) return;
      if (agent) {
        if (launchInFlight.current) return;
        launchInFlight.current = true;
        setLaunchingAgent(agent);
      }
      try {
        // 新しい端末は、いま見ているペインと同じディレクトリで開く
        const { result } = await runAction(agent ? 'launchAgent' : 'newWindow', {
          target: session,
          after: true,
          cwd: other ? undefined : activePane?.path,
          ...(agent ? { agent } : {}),
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
        toast(`${agent || 'newWindow'}: ${(err as Error).message}`);
      } finally {
        if (agent) { launchInFlight.current = false; setLaunchingAgent(null); }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusedTerminalTab, focusedDevice, sessions, activePane, setLayout, refresh, toast],
  );

  const activate = useCallback(
    (tabId: string) => {
      setLayout((prev) => (prev ? activateTab(prev, tabId) : prev));
      // 1 パネル表示では、別のパネルのタブへ移ると見えるパネルも変わる（Alt+数字・Alt+[ ]）
      const leaf = layoutRef.current ? findTab(layoutRef.current, tabId)?.leaf : null;
      if (leaf) { setFocusedId(leaf.id); focusSoon(leaf.id); }
    },
    [setLayout],
  );

  const closeTabById = useCallback(
    (tabId: string) => setLayout((prev) => (prev ? closeTab(prev, tabId) : prev)),
    [setLayout],
  );

  /** タブの表示名。パネルは番号ではなく、表示中のタブ名で示す（「api」のパネル） */
  const tabTitle = useCallback(
    (t: TabRef | undefined) => {
      if (!t) return '';
      if (isScreenTab(t)) return devices.find(d => d.id === t.deviceId)?.name ?? 'リモートデスクトップ';
      const w = t.windowId ? windows.find(x => x.id === t.windowId) : windows.find(x => x.sessionId === t.sessionId && x.active);
      return (w && views.get(w.id)?.project) || t.sessionName || '端末';
    },
    [windows, views, devices],
  );

  /** まとめて閉じる直前の配置。『元に戻す』トーストと対で 1 つだけ持つ */
  const undoRef = useRef<{ snap: LayoutSnapshot; toastId: number } | null>(null);
  const dropUndo = useCallback(() => {
    const held = undoRef.current;
    if (!held) return;
    undoRef.current = null;
    setToasts((list) => list.filter((x) => x.id !== held.toastId));
  }, []);
  // 閉じたあとに別の変更（別の画面からの同期を含む）が入ったら、もう戻さない
  useEffect(() => {
    const held = undoRef.current;
    if (held && !sameLayout(layout, held.snap.after)) dropUndo();
  }, [layout, dropUndo]);

  /**
   * まとめて閉じて、5 秒間『元に戻す』を出す。戻すときもふつうの更新として書くので、
   * workspace-sync で他の画面にも同じように届く。
   */
  const closeWithUndo = useCallback(
    (fn: (tree: LayoutNode) => LayoutNode | null, message: (before: LayoutNode, after: LayoutNode | null) => string) => {
      const before = layoutRef.current;
      if (!before) return;
      const after = fn(before);
      if (sameLayout(before, after)) return;
      dropUndo();
      const snap = snapshotLayout(before, after, focusedIdRef.current);
      layoutRef.current = after;
      setLayout(after);
      const toastId = toast(message(before, after), 'info', {
        label: '元に戻す',
        run: () => {
          const held = undoRef.current;
          const back = held?.snap === snap ? undoLayout(layoutRef.current, snap) : null;
          dropUndo();
          if (!back) return;
          layoutRef.current = back.layout;
          setLayout(back.layout);
          setFocusedId(back.focusedId);
          // 押したトーストは消えるので、入力の先を戻したパネルの端末へ返す
          if (back.focusedId) focusSoon(back.focusedId);
        },
      });
      undoRef.current = { snap, toastId };
      setTimeout(() => { if (undoRef.current?.snap === snap) undoRef.current = null; }, UNDO_MS);
    },
    [setLayout, setFocusedId, toast, dropUndo],
  );

  const closeTile = useCallback(
    (leafId: string) =>
      closeWithUndo(
        (tree) => removeLeaf(tree, leafId),
        (before) => {
          const leaf = findLeaf(before, leafId);
          return `「${tabTitle(leaf ? activeTab(leaf) ?? undefined : undefined)}」のパネルを閉じました（${leaf?.tabs.length ?? 0} タブ）`;
        },
      ),
    [closeWithUndo, tabTitle],
  );

  /** タブ列や端末に落とされた。ここで動くのはブラウザ側の配置だけで、tmux は触らない */
  const onDrop = useCallback(
    (target: DropTarget, payload: DragPayload) => {
      const tree = layoutRef.current;
      /** 落とされたものから新しく作るタブ（すでに開いていればそちらを動かす） */
      const fresh = (): TabRef => payload.kind === 'screen' ? makeScreenTab(payload.deviceId) : makeTab(payload.sessionId, payload.windowId);
      if (!tree) {
        const leaf = makeLeaf(fresh());
        setLayout(leaf);
        setFocusedId(leaf.id);
        return;
      }
      const open = payload.kind === 'screen'
        ? findScreenTab(tree, payload.deviceId)
        : findByTarget(tree, payload.sessionId, payload.windowId);

      if (target.kind === 'tab') {
        if (open) {
          setLayout(moveTab(tree, open.tab.id, target.leafId, target.before));
        } else {
          setLayout(addTab(tree, target.leafId, fresh(), target.before));
        }
        setFocusedId(target.leafId);
        focusSoon(target.leafId);
        return;
      }

      // 端に落とした = 新しいタイルとして並べる。
      // 1 枚しかないタイルを自分自身の隣に出しても、同じものが並ぶだけなので何もしない
      if (open && open.leaf.id === target.leafId && open.leaf.tabs.length === 1) return;
      const tab = open?.tab ?? fresh();
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
      // リモートデスクトップのタブは tmux のウィンドウではないので、木には落とせない
      if (payload.kind === 'screen') return;
      if (deviceOf(target.sessionId) !== deviceOf(payload.sessionId)) { toast('デバイスをまたぐ移動・結合はできません。'); return; }
      if (payload.kind === 'session') {
        if (target.kind !== 'session') return;
        const from = sessions.find((s) => s.id === payload.sessionId);
        const to = sessions.find((s) => s.id === target.sessionId);
        if (!from || !to) return;
        confirmThen(
          `「${from.name}」を「${to.name}」にまとめますか？`,
          `${from.windows} 個の端末が「${to.name}」へ移り、「${from.name}」は無くなります。` +
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
    onDesktopDrag(workspaceId, payload, end);
  }, [onDesktopDrag, workspaceId]);

  /** 画面（スクロールバックを含む）を丸ごとコピーする。選択とは別物だと分かる名前にする */
  const copyPane = useCallback(async (pane: Pane | null) => {
    if (!pane) return;
    try {
      const { text } = await fetchCapture(pane.id, 5000, true);
      await navigator.clipboard.writeText(text.replace(/\s+$/, ''));
      toast(`ペイン ${pane.index} の全文（履歴込み）をコピーしました`, 'info');
    } catch (err) {
      toast(`コピーに失敗: ${(err as Error).message}`);
    }
  }, [toast]);

  const killPane = useCallback((pane: Pane | null) => {
    if (!pane) return;
    const last = panes.filter((p) => p.windowId === pane.windowId).length <= 1;
    confirmThen(
      `ペイン ${pane.index} を終了しますか？`,
      `${paneCommand(pane)} が ${pane.path} で動いています。` +
        (last ? '\nこの端末の最後のペインなので、端末ごと無くなります。' : ''),
      () => doAction('killPane', { target: pane.id }),
      { confirmLabel: '終了する' },
    );
  }, [panes, confirmThen, doAction]);

  const killWindow = useCallback(
    (win: TmuxWindow) =>
      confirmThen(
        `端末「${win.name}」を終了しますか？`,
        'この中で動いているプロセスはすべて終了します。' +
          '\n（タブだけ閉じたいなら「タブを閉じる」を使ってください）',
        () => doAction('killWindow', { target: win.id }),
        { confirmLabel: '終了する' },
      ),
    [confirmThen, doAction],
  );

  /** クリップボードの文字を入力先の端末へ貼り付ける */
  const pasteClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) focusedTerm()?.paste(text);
    } catch {
      toast('クリップボードを読めませんでした（HTTPS で開いてください）');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  /** タブ 1 枚に効く操作の文脈。タブメニューと、端末メニューの「タブを閉じる」で使う */
  const tabContext = useCallback(
    (tabId: string): TabContext | undefined => {
      const tree = layoutRef.current;
      const found = tree ? findTab(tree, tabId) : null;
      if (!tree || !found) return undefined;
      const { leaf, tab } = found;
      const win = isTerminalTab(tab) ? windows.find((w) => w.id === tab.windowId) ?? null : null;
      const label = isScreenTab(tab) ? devices.find(d => d.id === tab.deviceId)?.name ?? 'リモートデスクトップ' : win?.name ?? '';
      const others = leaf.tabs.filter((t) => t.id !== tabId).map((t) => t.id);
      const at = leaf.tabs.findIndex((t) => t.id === tabId);
      const right = leaf.tabs.slice(at + 1).map((t) => t.id);
      const leavesNow = allLeaves(tree);
      return {
        index: at,
        count: leaf.tabs.length,
        screen: isScreenTab(tab),
        hasWindow: !!win,
        others: others.length,
        right: right.length,
        desktops: desktopTargets.filter(d => d.id !== workspaceId),
        panels: leavesNow.filter(l => l.id !== leaf.id).map(target => ({
          id: target.id,
          name: tabTitle(activeTab(target) ?? undefined),
          tabs: target.tabs.length,
        })),
        moveLeft: () => setLayout(prev => prev ? moveTab(prev, tabId, leaf.id, leaf.tabs[at - 1]?.id) : prev),
        moveRight: () => setLayout(prev => prev ? moveTab(prev, tabId, leaf.id, leaf.tabs[at + 2]?.id ?? null) : prev),
        moveToDesktop: (id) => onMoveDesktopTab(workspaceId, tabId, id),
        moveToPanel: (id) => { setLayout(prev => prev ? moveTab(prev, tabId, id, null) : prev); setFocusedId(id); },
        close: () => closeTabById(tabId),
        closeOthers: () => closeWithUndo((prev) => closeTabs(prev, others), () => `他のタブを ${others.length} 枚閉じました`),
        closeRight: () => closeWithUndo((prev) => closeTabs(prev, right), () => `右側のタブを ${right.length} 枚閉じました`),
        split: (side) => onDrop({ kind: 'split', leafId: leaf.id, side }, tabPayload(tab, label)),
        // 同じ画面を二重に繋がないよう、タブを閉じてからダイアログで開く
        openAsDialog: () => { if (isScreenTab(tab)) { closeTabById(tabId); setScreenOpen(tab.deviceId); } },
        renameWindow: () =>
          win &&
          setDialog({
            kind: 'prompt',
            title: `端末「${win.name}」の名前を変更`,
            defaultValue: win.name,
            confirmLabel: '変更',
            onSubmit: (name) =>
              name.trim() && doAction('renameWindow', { target: win.id, name: name.trim() }),
          }),
        killWindow: () => win && killWindow(win),
      };
    },
    [windows, devices, tabTitle, closeTabById, closeWithUndo, setLayout, onDrop, doAction, killWindow, desktopTargets, workspaceId, onMoveDesktopTab],
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

  const onToggle = useCallback(
    (key: 'mode' | 'showStatusBar' | 'inputBar' | 'altKeys') => {
      if (key === 'mode') {
        // 端末をすべてつなぎ直すので、切り替える前に確かめる（『表示と接続』と同じ）
        const next = mode === 'mirror' ? 'direct' : 'mirror';
        confirmThen(`接続方式を『${next === 'mirror' ? 'ミラー' : '直接'}』に切り替えますか？`,
          '開いている端末をすべてつなぎ直します。tmux と実行中の処理はそのまま続きます。',
          () => setMode(next), { confirmLabel: '切り替える', danger: false });
      }
      if (key === 'showStatusBar') setShowStatusBar((v) => !v);
      if (key === 'inputBar') setInputBar((v) => nextInputBar(v));
      if (key === 'altKeys') setAltKeys((v) => !v);
    },
    [mode, confirmThen, setMode, setShowStatusBar, setInputBar, setAltKeys],
  );

  // ------------------------------------------------------------ 切り替え

  /**
   * Alt+1..9 / Alt+0 / Alt+[ ] が数えるタブ。見えているタブ列と同じ順：
   * 分割表示では入力先のパネルの中、1 パネル表示ではワークスペース全体
   */
  const tabOrder = useMemo(
    () => visibleTabOrder(layout, focusedLeaf, singlePanel),
    [layout, focusedLeaf, singlePanel],
  );

  /** 見えているタブ列の中で、前面のタブから n 枚ぶん送る */
  const stepTab = useCallback(
    (delta: number) => {
      const next = stepInOrder(tabOrder, focusedTab?.id ?? null, delta);
      if (next && next.id !== focusedTab?.id) activate(next.id);
    },
    [tabOrder, focusedTab, activate],
  );

  /** 切り替えパレットに出す一覧。直前に見ていた順 → 状態の強い順 */
  const switchItems = useMemo<SwitchItem[]>(() => {
    const openIds = new Set(tabs.map((t) => isTerminalTab(t.tab) ? t.tab.windowId : null).filter(Boolean) as string[]);
    const order = recent;
    return windows
      .map((win) => ({
        view: views.get(win.id)!,
        open: openIds.has(win.id),
        session: win.sessionName,
        deviceName: devices.find(device => device.id === deviceOf(win.id))?.name || 'このPC',
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
  }, [windows, views, tabs, recent, devices]);

  /**
   * ブラウザ側のショートカット。
   *
   * capture 段階で受けるのが肝心。xterm のリスナは補助 textarea に付いていて、
   * bubble で受けると xterm のほうが先に動き、Alt+B が `ESC b` として tmux に
   * 流れてしまう（readline では単語単位のカーソル移動）。ここで捕まえて止める。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 設定でオフにしたときは何も奪わず、xterm に任せる（Alt+B などがそのまま ESC b として届く）
      if (!altKeys) return;
      if (!active || projectMode || approvalOpen || remotePane || screenOpen || filesPaneId || !e.altKey || e.ctrlKey || e.metaKey) return;
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

      if (document.querySelector('dialog[open], [role=menu], [aria-modal=true]')) return;
      // Alt+Shift+P：パレットを『操作』で開く。ほかの Alt+Shift はワークスペース（Desktops.tsx）が受ける
      if (e.shiftKey) {
        if (e.code === 'KeyP') { stop(); setPalette('command'); }
        // Alt+Shift+T：新規メニュー（続けて T・C・X・R）。Alt+Shift+C / X：Claude / Codex を起動
        else if (e.code === 'KeyT') { stop(); latestKeys.current.openNewMenuAtStrip(); }
        else if (e.code === 'KeyC') { stop(); latestKeys.current.launchAgent('claude'); }
        else if (e.code === 'KeyX') { stop(); latestKeys.current.launchAgent('codex'); }
        return;
      }
      // Alt+/：ショートカット一覧。配列によって key が変わるので code も見る
      if (e.code === 'Slash' || e.key === '/') { stop(); setShortcutsOpen(true); return; }
      if (key === 'enter') { stop(); setPanelFocus(v => !v); return; }
      if (digit >= 1 && digit <= 9) {
        const tab = tabOrder[digit - 1];
        if (tab) {
          stop();
          activate(tab.id);
        }
        return;
      }
      if (digit === 0) {
        const tab = tabOrder[tabOrder.length - 1];
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
      } else if (e.code === 'KeyJ' || key === 'j') {
        // Alt+J：次の入力待ちの端末へ
        stop();
        latestKeys.current.goNextWaiting();
      } else if (e.code === 'KeyO' || key === 'o') {
        // Alt+O：入力先の端末の作業フォルダーを開く。端末でなければ何も奪わない
        if (latestKeys.current.openFiles()) stop();
      } else if (key === 'b') {
        stop();
        setSidebarOpen((v) => !v);
      } else if (key === 'p') {
        stop();
        setPalette((v) => (v ? null : 'terminal'));
      } else if (key === 't') {
        stop();
        newTerminal(focusedIdRef.current);
      } else if (key === 'w' && focusedTab) {
        stop();
        closeTabById(focusedTab.id);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [altKeys, active, projectMode, approvalOpen, remotePane, screenOpen, filesPaneId, tabOrder, focusedTab, activate, stepTab, newTerminal, closeTabById, setSidebarOpen]);

  /** あるペインに効く操作。入力先のペインのほか、メニューを開いたタブのペインにも使う */
  const paneActions = (pane: Pane | null) => ({
    onCopyPane: () => copyPane(pane),
    onKillPane: () => killPane(pane),
    onRemoteControl: () => { if (pane) setRemotePane(pane.id); },
    onExitClaude: () => {
      if (!pane) return;
      confirmThen(
        'Claude を終了しますか？',
        `${pane.path} で動いている Claude に /exit を送ります。会話は終わり、端末はシェルに戻ります。`,
        () => doAction('runCommand', { target: pane.id, command: '/exit' }),
        { confirmLabel: '終了する' },
      );
    },
    onOpenFiles: () => { if (pane) setFilesPaneId(pane.id); },
    onSelectText: () => { if (pane) setTextCopyPane(pane); },
    onSendCommand: () => {
      if (!pane) return;
      setDialog({
        kind: 'prompt',
        title: `ペイン ${pane.index} (${paneCommand(pane)}) にコマンドを送る`,
        placeholder: 'コマンド',
        confirmLabel: '送信',
        onSubmit: (cmd) => cmd.trim() && doAction('runCommand', { target: pane.id, command: cmd }),
      });
    },
  });

  const appContext: AppContext = {
      session: currentSession,
      window: currentWindow,
      activePane: activePane,
      mode: mode,
      showStatusBar: showStatusBar,
      inputBar: inputBar,
      altKeys: altKeys,
      onAction: doAction,
      onNewTab: () => newTerminal(focusedIdRef.current),
      onLaunchAgent: launchAgent,
      launchingAgent: launchingAgent,
      onSplitNewWindow: splitIntoNewWindow,
      onOpenNewMenu: () => openNewMenuAtStrip(),
      waitingCount: waitingIds.length,
      onNextWaiting: () => goNextWaiting(),
      onToggle: onToggle,
      screenTab: focusedScreen,
      ...paneActions(activePane),
      onOpenScreen: () => setScreenOpen(activeDevice.id),
      onOpenScreenTab: () => openScreen(activeDevice.id, focusedIdRef.current),
      canOpenTerminal: !!focusedDevice && sessions.some(s => deviceOf(s.id) === focusedDevice),
      onOpenSwitcher: () => setPalette('terminal'),
      onOpenShortcuts: () => setShortcutsOpen(true),
      onOpenSettings: () => onOpenSettings?.(),
      appInstalled: install.installed,
      onInstallApp: () => void requestInstall(),
      approvalPending: !!approval.pending,
      onOpenApproval: openApproval,
      onPaste: pasteClipboard,
  };

  const openNewSession = (deviceId: string = activeDevice.id) => setDialog({
    kind: 'prompt',
    title: '新しいセッションを作る',
    detail: '名前は省略できます（tmux が番号を振ります）。',
    placeholder: 'セッション名',
    confirmLabel: '作成',
    onSubmit: (name) => doAction('newSession', { deviceId, ...(name.trim() ? { name: name.trim() } : {}) }),
  });

  /** 新規メニューとパレットの『作る』に渡す文脈。leafId のパネルに開く */
  const createContext = (leafId?: string | null): CreateContext => ({
    devices: devices.map(d => ({ id: d.id, name: d.name, connected: d.connected })),
    current: focusedDevice ?? activeDevice.id,
    newTerminal: (deviceId) => newTerminal(leafId ?? focusedIdRef.current, undefined, deviceId),
    openScreen: (deviceId) => openScreen(deviceId, leafId ?? focusedIdRef.current),
    newProject: () => setProjectMode('new'),
    openFolder: () => setProjectMode('existing'),
    resume: () => setResumeOpen(true),
    newSession: () => openNewSession(),
  });

  /**
   * そのデバイスを対象にした新規メニューの文脈（一覧の『＋ 新規 ▾』とデバイス見出しの『ここで新規 ▸』）。
   * 入力先のパネルに開く。プロジェクト・会話の再開・セッション作成は、そのデバイスを選んでから開く。
   */
  const deviceMenuContext = (deviceId: string, leafId?: string | null): CommandContext => {
    const base = createContext(leafId);
    const hasSession = sessions.some(s => deviceOf(s.id) === deviceId);
    const choose = (run: () => void) => () => { setSelectedDevice(deviceId); run(); };
    return {
      app: {
        ...appContext,
        canOpenTerminal: hasSession,
        onNewTab: () => newTerminal(leafId ?? focusedIdRef.current, undefined, deviceId),
        onLaunchAgent: (agent) => void launchAgent(agent, deviceId),
        onSplitNewWindow: (side, agent) => void splitIntoNewWindow(side, agent, deviceId),
      },
      create: {
        ...base,
        current: deviceId,
        newProject: choose(() => setProjectMode('new')),
        openFolder: choose(() => setProjectMode('existing')),
        resume: choose(() => setResumeOpen(true)),
        newSession: () => openNewSession(deviceId),
      },
    };
  };

  /**
   * 新規メニュー（＋▾）。先頭の 3 行（端末・Claude・Codex）は T・C・X、リモートデスクトップ ▸ は R で選べる。
   * 中身は入力先のパネル（leafId）に開く。
   */
  const openNewMenu = (anchor: { x: number; y: number }, leafId?: string | null, deviceId?: string) => {
    const items = buildMenu(NEW_MENU, deviceId ? deviceMenuContext(deviceId, leafId) : {
      app: { ...appContext, onNewTab: () => newTerminal(leafId ?? focusedIdRef.current) },
      create: createContext(leafId),
    });
    const device = deviceId ? devices.find(d => d.id === deviceId) : null;
    setMenu({ x: anchor.x, y: anchor.y, items, title: device ? `新規 · ${device.name}` : '新規' });
  };

  /** 一覧の行の『右に並べて開く / 下に並べて開く』。端末の端にドラッグしたときと同じ */
  const openWindowSide = (win: TmuxWindow, side: 'right' | 'bottom') => {
    const tree = layoutRef.current;
    const leaf = tree ? anchorLeaf(tree) : null;
    if (isNarrow()) setSidebarOpen(false);
    if (!leaf) { openWindow(win); return; }
    onDrop({ kind: 'split', leafId: leaf.id, side }, { kind: 'window', sessionId: win.sessionId, windowId: win.id, label: win.name });
  };

  /** Alt+Shift+T とパレットから：入力先のパネルの ▾ の下に新規メニューを開く */
  const openNewMenuAtStrip = () => {
    // スマホの見出しでは、タイル見出しの ▾ は隠れていて見出しの ▾ を使う
    const visible = (el: HTMLElement | null) => el && el.getClientRects().length ? el : null;
    const button = visible(document.querySelector<HTMLElement>('.desktop-bar .phone-new .new-more'))
      ?? document.querySelector<HTMLElement>('.tile.focused .new-more') ?? document.querySelector<HTMLElement>('.tile:not([hidden]) .new-more');
    const r = button?.getBoundingClientRect();
    openNewMenu(r ? { x: r.left, y: r.bottom } : { x: window.innerWidth / 2 - 120, y: 80 }, focusedIdRef.current);
  };

  /** Alt+J：次の入力待ちの端末へ移る。開いていなければ入力先のパネルにタブで開く */
  const goNextWaiting = () => {
    const id = nextWaiting(waitingIds, currentWindow?.id ?? null);
    const win = id ? windows.find(w => w.id === id) : null;
    if (win) { openWindow(win); return; }
    toast(waitingIds.length ? 'ほかに入力待ちの端末はありません' : '入力待ちの端末はありません', 'info');
  };

  /** キー操作から呼ぶ、毎回作り直される関数の最新版 */
  latestKeys.current = {
    openNewMenuAtStrip,
    launchAgent,
    goNextWaiting,
    openFiles: () => {
      if (!activePane) return false;
      setFilesPaneId(activePane.id);
      return true;
    },
  };

  /** パレットの『タブ』：このワークスペースのタブをパネル別に。パネルは表示中のタブ名で示す */
  const paletteTabGroups = useMemo<PaletteTabGroup[]>(() => {
    const describe = (tab: TabRef) => {
      const device = devices.find(d => d.id === tabDevice(tab));
      const deviceText = `${device?.name || '接続先を確認中'}${device && !device.connected ? ' · 未接続' : ''}`;
      const remote = !!device && !device.local;
      if (isScreenTab(tab)) {
        return { title: 'リモートデスクトップ', task: device?.name || '画面', device: deviceText, screen: true, remote: false,
          search: ['リモートデスクトップ', 'デスクトップ', '画面', device?.name].join(' ') };
      }
      const win = tab.windowId ? windows.find(w => w.id === tab.windowId) : windows.find(w => w.sessionId === tab.sessionId && w.active);
      const view = win ? views.get(win.id) : undefined;
      const title = view?.project || tab.sessionName || '端末';
      const task = view?.primary || tab.windowName || '端末';
      return { title, task, device: deviceText, kind: view?.status.kind ?? 'idle', remote, search: [view?.project, view?.primary, tab.sessionName, device?.name].join(' ') };
    };
    return leaves.map(leaf => {
      const tabsInLeaf = leaf.tabs.map(tab => ({ id: tab.id, active: tab.id === leaf.activeId, ...describe(tab) }));
      return {
        leafId: leaf.id,
        name: tabsInLeaf.find(t => t.active)?.title ?? tabsInLeaf[0]?.title ?? '',
        focused: leaf.id === (focusedLeaf?.id ?? leaves[0]?.id),
        tabs: tabsInLeaf,
      };
    });
  }, [leaves, focusedLeaf, devices, windows, views]);

  /** 画面タブのデバイスを差し替える。そのデバイスの画面タブが既にあれば、そちらを前に出す */
  const switchScreenDevice = (tabId: string, deviceId: string) => {
    const tree = layoutRef.current;
    if (!tree) return;
    const existing = findScreenTab(tree, deviceId, tabId);
    setLayout(retargetScreenTab(tree, tabId, deviceId));
    const leafId = existing?.leaf.id ?? findTab(tree, tabId)?.leaf.id;
    if (leafId) { setFocusedId(leafId); focusSoon(leafId); }
  };

  /**
   * 画面メニューの文脈。前面の画面タブは RemoteScreen から状態を受け取り、
   * 裏のタブ（まだ描いていない）は『ダイアログで大きく表示』と『別のデバイスに切り替え』だけを押せるようにする。
   */
  const screenContextFor = (tabId: string): ScreenContext | undefined => {
    const tree = layoutRef.current;
    const found = tree ? findTab(tree, tabId) : null;
    if (!found || !isScreenTab(found.tab)) return undefined;
    const { leaf, tab } = found;
    const handle = leaf.activeId === tabId ? termRefs.current.get(leaf.id) : undefined;
    const noop = () => {};
    const base: ScreenContext = handle && !isTerminalHandle(handle) ? handle.context() : {
      ready: false, modal: false, connected: false, viewOnly: false, fit: true, copying: false, full: false,
      canFullscreen: false, narrow: false, current: tab.deviceId,
      devices: devices.map(d => ({ id: d.id, name: d.name, connected: d.connected })),
      setViewOnly: noop, setFit: noop, copy: noop, reconnect: noop, sendEscape: noop, toggleFullscreen: noop,
      switchDevice: noop, openQuality: noop, sendCtrlAltDel: noop, openGuide: noop, openText: noop,
    };
    return {
      ...base,
      openAsDialog: () => tabContext(tabId)?.openAsDialog(),
      switchDevice: (id) => switchScreenDevice(tabId, id),
    };
  };

  /** 一覧（サイドバー）全体の操作。パレットの『操作』から使う（一覧の ⋯ は Sidebar が同じものを作る） */
  const listContext = (): ListContext => {
    const unique = [...new Map(windows.map(w => [w.id, w])).values()];
    const open = new Set(tabs.map(({ tab }) => (isTerminalTab(tab) ? tab.windowId : null)).filter(Boolean));
    const pinned = (w: TmuxWindow) => w.id === focusedTerminalTab?.windowId || open.has(w.id);
    return {
      groupBy,
      setGroupBy,
      closable: unique.filter(w => isClosable(w, views, pinned(w))).length,
      cleanUp: () => confirmCleanUp(unique, '', views, pinned, confirmThen, doAction),
      manageDevices: () => setDevicesOpen(true),
      close: sidebarOpen ? () => setSidebarOpen(false) : undefined,
    };
  };

  /** パレットの『操作』。パレット自身を開く操作は出さない */
  const paletteCommandList = () => paletteCommands({
    app: appContext,
    panel: { multiple: leaves.length >= 2, toggleFocus: () => setPanelFocus(v => !v) },
    tab: focusedTab ? tabContext(focusedTab.id) : undefined,
    view: { fontSize, lineHeight, setFontSize, setLineHeight, stepLineHeight: onLineHeightStep },
    create: createContext(),
    desktop: workspace,
    screen: focusedTab && isScreenTab(focusedTab) ? screenContextFor(focusedTab.id) : undefined,
    list: listContext(),
  }, new Set(['navigate.switcher']));

  /**
   * タブメニュー。タブの右クリック・長押し・⋯、端末の右クリック・長押しで同じものを開く。
   * ペインに効く操作（コピー・ファイル・コマンド・tmux）は、入力先ではなくメニューを開いたタブのペインに効く。
   * 選択と貼り付けは、そのタブがパネルの前面にあるときだけ使える（裏のタブには端末が描かれていない）。
   */
  const openTabMenu = (tabId: string, anchor: { x: number; y: number }, panel?: PanelContext, lead: MenuEntry[] = []) => {
    const tree = layoutRef.current;
    const found = tree ? findTab(tree, tabId) : null;
    const tab = tabContext(tabId);
    if (!found || !tab) return;
    const { leaf, tab: ref } = found;
    const front = leaf.activeId === tabId;
    const handle = front ? termRefs.current.get(leaf.id) : undefined;
    const term = isTerminalHandle(handle) ? handle : undefined;
    const win = isTerminalTab(ref)
      ? (ref.windowId ? windows.find(w => w.id === ref.windowId) : windows.find(w => w.sessionId === ref.sessionId && w.active)) ?? null
      : null;
    const paneList = win ? panes.filter(p => p.windowId === win.id).sort((a, b) => a.index - b.index) : [];
    const pane = paneList.find(p => p.active) ?? paneList[0] ?? null;
    const selectionText = term?.getSelection().trim() ?? '';
    const selection: SelectionContext = {
      text: selectionText,
      copy: async () => {
        const text = term?.getSelection() ?? '';
        if (!text) return;
        try {
          await navigator.clipboard.writeText(text);
          toast(`選択した ${text.split('\n').length} 行をコピーしました`, 'info');
        } catch (err) {
          toast(`コピーに失敗: ${(err as Error).message}`);
        }
      },
      clear: () => term?.clearSelection(),
    };
    const app: AppContext = {
      ...appContext,
      session: isTerminalTab(ref) ? sessions.find(s => s.id === ref.sessionId) ?? null : null,
      window: win,
      activePane: pane,
      ...paneActions(pane),
      screenTab: isScreenTab(ref),
      canPaste: !!term,
      onPaste: async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) term?.paste(text);
        } catch {
          toast('クリップボードを読めませんでした（HTTPS で開いてください）');
        }
      },
    };
    const items = tabMenuItems({
      app,
      selection,
      tab,
      panel: panel ?? { multiple: leaves.length >= 2, maximized: panelFocus, toggleFocus: () => setPanelFocus(v => !v) },
      strip: { tabCount: leaf.tabs.length, closable: allLeaves(tree!).length > 1, closePanel: () => closeTile(leaf.id) },
    });
    const title = isScreenTab(ref)
      ? devices.find(d => d.id === ref.deviceId)?.name ?? 'リモートデスクトップ'
      : (win && views.get(win.id)?.project) || ref.sessionName || '端末';
    // 画面タブでは、画面メニューを先頭の段に入れる
    const screen = isScreenTab(ref) ? screenContextFor(tabId) : undefined;
    const screenItems = screen ? [...screenMenuItems({ screen }), SEP] : [];
    setMenu({ x: anchor.x, y: anchor.y, items: [...lead, ...screenItems, ...items], title });
  };

  // ---------------------------------------------------------------- スマホの見出し 1 行
  // ≡ ／ 現在のタブ ▾ n/m ／ 要対応 N（切断中は ✕ 切断）／ ＋▾ ／ ⋯。タブ列の代わりにタブ一覧シートを開く
  const [tabSheetOpen, setTabSheetOpen] = useState(false);
  useEffect(() => { if (!phone) setTabSheetOpen(false); }, [phone]);
  const headLeaf = focusedLeaf ?? leaves[0] ?? null;
  const headTab = headLeaf ? activeTab(headLeaf) : null;
  const headInfo = headTab ? paletteTabGroups.find(g => g.leafId === headLeaf?.id)?.tabs.find(t => t.id === headTab.id) : undefined;
  const headIndex = headTab ? tabs.findIndex(t => t.tab.id === headTab.id) : -1;
  const attentionCount = waitingIds.length + (approval.pending ? 1 : 0);
  /** 見出しの『現在のタブ ▾ n/m』の名前。表示と同じ語を先に置く（aria-label と title は同じ文字列） */
  const headLabel = headTab ? `${headInfo?.title ?? '端末'} ${headIndex + 1}/${tabs.length}（タブ一覧）` : 'タブなし（タブ一覧）';
  /** 見出しの ⋯ のシートの先頭：見出しに置かない ⌕ と接続状態 */
  const phoneLead = (): MenuEntry[] => phone ? [
    { label: '探す・操作', hint: altKeys ? 'Alt+P' : undefined, run: () => { setPaletteWaiting(false); setPalette('terminal'); } },
    { label: `接続状態：${phone.connection}`, run: phone.openConnection },
    SEP,
  ] : [];
  const openHeadMenu = (x: number, y: number) => {
    if (headTab) openTabMenu(headTab.id, { x, y }, undefined, phoneLead());
    else setMenu({ x, y, items: phoneLead().filter(Boolean), title: 'メニュー' });
  };
  const headTabPress = useLongPress<null>((_, { x, y }) => openHeadMenu(x, y));
  const headPlusPress = useLongPress<null>((_, { x, y }) => openNewMenu({ x, y }, headLeaf?.id ?? null));

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-hidden'}`} style={{ '--sidebar-w': `${Math.min(600, Math.max(200, Number(sidebarWidth) || 260))}px` } as React.CSSProperties}>
      {active && barSlots?.leading && createPortal(
        <button className="bar-btn bar-sidebar" aria-label="一覧" title="一覧 (Alt+B)" aria-pressed={!!sidebarOpen}
          onClick={() => setSidebarOpen(v => !v)}><Icon name="menu" /></button>, barSlots.leading)}
      {active && barSlots?.status && createPortal(<>
        <span className="bar-live" aria-live="polite">
          {waitingIds.length > 0 && <button className="bar-chip attention" title={`入力待ち ${waitingIds.length} (Alt+J で次へ)`}
            onClick={() => { setPaletteWaiting(true); setPalette('terminal'); }}>
            <Icon name="diamond" /><span className="bar-chip-text">入力待ち</span> {waitingIds.length}
          </button>}
          {/* スマホの見出しでは、入力待ちと承認待ちを『要対応 N』にまとめる（入力待ちのチップは隠れるので、ここで読み上げる） */}
          {barSlots.phone && attentionCount > 0 && <button className="bar-chip needs" title={`要対応 ${attentionCount}（入力待ち ${waitingIds.length}${approval.pending ? '・承認待ち 1' : ''}）`}
            onClick={() => { if (approval.pending && !waitingIds.length) openApproval(); else { setPaletteWaiting(true); setPalette('terminal'); } }}>
            <Icon name={approval.pending ? 'warning' : 'diamond'} /><span className="bar-chip-text">要対応</span> {attentionCount}
          </button>}
        </span>
        {approval.pending && <button className="bar-chip approval" title={`承認待ち：${approval.pending.cmd}`}
          onClick={openApproval}>
          <Icon name="warning" /><span className="bar-chip-text">承認待ち</span> 1
        </button>}
      </>, barSlots.status)}
      {active && barSlots?.phone && createPortal(
        <button className="bar-btn phone-tab" aria-haspopup="dialog" aria-expanded={tabSheetOpen}
          aria-label={headLabel} title={headLabel}
          {...headTabPress.bind(null)}
          onContextMenu={e => { e.preventDefault(); headTabPress.cancel(); const r = e.currentTarget.getBoundingClientRect(); openHeadMenu(e.clientX || r.left, e.clientY || r.bottom); }}
          onKeyDown={e => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); openHeadMenu(r.left, r.bottom); } }}
          onClick={() => setTabSheetOpen(true)}>
          {headInfo?.screen ? <span className="tab-kind" aria-hidden="true"><Icon name="screen" /></span> : <span className={`state-dot ${headInfo?.kind ?? 'idle'}`} aria-hidden="true" />}
          <span className="phone-tab-title">{headTab ? headInfo?.title ?? '端末' : 'タブなし'}</span>
          <Icon name="chevron-down" />
          {headTab && <span className="phone-tab-count">{headIndex + 1}/{tabs.length}</span>}
        </button>, barSlots.phone)}
      {active && barSlots?.phoneEnd && createPortal(<>
        <div className="split-new phone-new" role="group" aria-label="新しく開く">
          <button className="bar-btn new-main" title="新しい端末 (Alt+T)" aria-label="新しい端末"
            {...headPlusPress.bind(null)}
            onContextMenu={e => e.preventDefault()}
            onClick={() => newTerminal(headLeaf?.id ?? null)}><Icon name="plus" /></button>
          <button className="bar-btn new-more" title="新規メニュー (Alt+Shift+T)" aria-label="新規メニュー" aria-haspopup="menu"
            onClick={e => { const r = e.currentTarget.getBoundingClientRect(); openNewMenu({ x: r.left, y: r.bottom }, headLeaf?.id ?? null); }}><Icon name="chevron-down" /></button>
        </div>
        <button className="bar-btn phone-more" title="タブの操作" aria-label="タブの操作" aria-haspopup="menu"
          onClick={e => { const r = e.currentTarget.getBoundingClientRect(); openHeadMenu(r.right, r.bottom); }}><Icon name="more" /></button>
      </>, barSlots.phoneEnd)}
      {active && barSlots?.trailing && createPortal(
        <button className="bar-btn bar-palette" aria-label="探す・操作" title="探す・操作 (Alt+P)"
          onClick={() => { setPaletteWaiting(false); setPalette('terminal'); }}>
          <Icon name="search" /><span className="bar-btn-text">探す・操作</span><kbd className="bar-kbd">Alt+P</kbd>
        </button>, barSlots.trailing)}

      {sidebarOpen && <button className="sidebar-backdrop" aria-label="一覧を閉じる"
        onClick={() => setSidebarOpen(false)} />}
      <Sidebar
        width={Math.min(600, Math.max(200, Number(sidebarWidth) || 260))}
        onResize={width => setSidebarWidth(Math.min(600, Math.max(200, width)))}
        devices={devices}
        selectedDevice={activeDevice.id}
        onSelectDevice={setSelectedDevice}
        sessions={sessions}
        windows={windows}
        views={views}
        home={home}
        groupBy={groupBy}
        activeSessionId={focusedTerminalTab?.sessionId ?? null}
        activeWindowId={focusedTerminalTab?.windowId ?? null}
        openWindowIds={tabs.map(({ tab }) => isTerminalTab(tab) ? tab.windowId : null)}
        connected={connected}
        unauthorized={unauthorized}
        onChangeGroupBy={setGroupBy}
        onSelectSession={(id) => {
          const first =
            windows.find((w) => w.sessionId === id && w.active) ??
            windows.find((w) => w.sessionId === id);
          if (first) openWindow(first);
        }}
        onSelectWindow={openWindow}
        onOpenWindowSide={openWindowSide}
        onAction={doAction}
        onKillWindow={killWindow}
        onClose={() => setSidebarOpen(false)}
        onConfirm={confirmThen}
        onOpenMenu={(items, anchor, title) => setMenu({ x: anchor.x, y: anchor.y, items, title })}
        menuContext={(deviceId) => deviceMenuContext(deviceId)}
        onNewMenu={(deviceId, anchor) => openNewMenu(anchor, null, deviceId)}
        onOpenScreen={(deviceId) => openScreen(deviceId)}
        onManageDevices={() => setDevicesOpen(true)}
        onStartDrag={startDrag}
        onDropInTree={dropInTree}
        drag={drag}
        draggingWindowId={drag?.kind === 'window' ? drag.windowId : null}
      />

      <main className={`main ${drag ? 'dragging' : ''}`}>



        <div className="workspace">
          <div className="terminal-wrap">
            {layout ? (
              <SplitView
                active={active}
                stripHidden={!!phone}
                tree={layout}
                statuses={termStatuses}
                focusMode={panelFocus}
                onToggleFocus={() => setPanelFocus(v => !v)}
                onOverview={() => setPalette('tab')}
                onSingleChange={setSinglePanel}
                focusedId={focusedId}
                devices={devices}
                onNewMenu={(leafId, x, y) => openNewMenu({ x, y }, leafId)}
                sessions={sessions}
                windows={windows}
                views={views}
                mode={mode}
                showStatusBar={showStatusBar}
                fontSize={fontSize}
                lineHeight={lineHeight}
                drag={drag}
                pendingRemap={needsRemap || !devicesReady}
                onFocus={setFocusedId}
                onActivateTab={activate}
                onCloseTab={closeTabById}
                onNewTab={(leafId, deviceId) => newTerminal(leafId, undefined, deviceId)}
                onDrop={onDrop}
                onStartDrag={startDrag}
                onDragEnd={() => setDrag(null)}
                onRatio={(id, r) => setLayout((prev) => (prev ? setRatio(prev, id, r) : prev))}
                onStatus={handleStatus}
                onNotice={(text) => toast(text)}
                onCopied={(text) => {
                  const lines = text.split('\n').length;
                  toast(
                    lines > 1
                      ? `${lines} 行をコピーしました`
                      : `「${text.length > 24 ? text.slice(0, 24) + '…' : text}」をコピーしました`,
                    'info',
                  );
                }}
                onTerminalContextMenu={(leafId, x, y, panel) => {
                  setFocusedId(leafId);
                  const leaf = layoutRef.current ? findLeaf(layoutRef.current, leafId) : null;
                  if (leaf) openTabMenu(leaf.activeId, { x, y }, panel);
                }}
                onTabContextMenu={(tabId, x, y, panel) => openTabMenu(tabId, { x, y }, panel)}
                registerTerm={registerTerm}
              />
            ) : (
              <div className="placeholder">
                {unauthorized ? (
                  <>
                    <p>Tailscale認証を確認してください。</p>
                    <p className="dim">
                      Tailscaleに接続して、許可されたアカウントで開いてください。
                      {authUrl && <><br /><a href={authUrl}>TailscaleのURLで開く</a></>}
                      セッションが消えたわけではありません。
                    </p>
                  </>
                ) : (
                  <DeviceStart devices={devices} ready={devicesReady}
                    onManageDevices={() => setDevicesOpen(true)}
                    onStarted={(deviceId, project) => { setSelectedDevice(deviceId); projectStarted(project); }} />
                )}
              </div>
            )}
          </div>
        </div>

        {/* 画面タブでは、入力行を画面用のキーと［⌨ 文字入力］に切り替える */}
        {focusedScreen && inputBar !== 'hidden' && <ScreenInputBar
          always={inputBar === 'always'}
          connected={!!focusedId && !!termStatuses[focusedId]?.connected}
          onKey={(keysym, code, mods) => focusedScreenHandle()?.pressKey(keysym, code, mods)}
          onText={() => focusedScreenHandle()?.openText()}
        />}
        {!focusedScreen && inputBar !== 'hidden' && <InputBar
          always={inputBar === 'always'}
          prefix={prefix}
          waiting={!!focusedTerminalTab?.windowId && views.get(focusedTerminalTab.windowId)?.status.kind === 'waiting'}
          connected={!!focusedId && !!termStatuses[focusedId]?.connected}
          onPaste={(text) => focusedTerm()?.paste(text)}
          onSend={(data) => focusedTerm()?.send(data)}
          onAttach={async (files) => {
            const target = focusedTerminalTab && { sessionId: focusedTerminalTab.sessionId, windowId: focusedTerminalTab.windowId };
            const terminal = focusedTerm();
            if (!target || !terminal) throw new Error('添付先の端末を選んでください。');
            const paths: string[] = [];
            try {
              for (const file of files) paths.push(await uploadAttachment(target.sessionId, file));
            } catch (err) {
              return { inserted: false, text: paths.length ? paths.map(quotePath).join(' ') + ' ' : '',
                error: `${paths.length}件を保存済み。${(err as Error).message}${paths.length ? ' 保存済みの添付パスは下書きに残しました。' : ''}` };
            }
            const text = paths.map(quotePath).join(' ') + ' ';
            return { text, inserted: terminal.paste(text, target) };
          }}
        />}
      </main>

      {devicesOpen && <Devices devices={devices} onChanged={reloadDevices} onClose={() => setDevicesOpen(false)} />}

      {filesPaneId && <FileBrowser key={filesPaneId} deviceName={devices.find(d=>d.id===deviceOf(filesPaneId))?.name || activeDevice.name} paneId={filesPaneId} onClose={() => setFilesPaneId(null)} />}



      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} title={menu.title} onClose={() => setMenu(null)} />}
      {textCopyPane && <TextCopy pane={textCopyPane} onClose={() => setTextCopyPane(null)}
        onCopied={(lines) => toast(`${lines} 行をコピーしました`, 'info')} onError={(text) => toast(text)} />}

      {resumeOpen && <ResumeConversation deviceId={activeDevice.id} deviceName={activeDevice.name} home={home} onClose={() => setResumeOpen(false)} onStarted={projectStarted} />}
      {projectMode && <ProjectStart deviceId={activeDevice.id} deviceName={activeDevice.name} home={home} initialMode={projectMode} onClose={() => setProjectMode(null)} onStarted={projectStarted} />}
      {approvalOpen && approval.pending && <ApprovalDialog key={approval.pending.id} pending={approval.pending} secure={approval.secure}
        onClose={() => setApprovalId(null)} onDone={() => { setApprovalId(id => id === approvalId ? null : id); approval.refresh(); }} />}
      {remotePane && <RemoteControl pane={remotePane} onClose={() => setRemotePane(null)} />}
      {screenOpen && <ScreenViewer devices={devices} deviceId={screenOpen} deviceName={devices.find(d => d.id === screenOpen)?.name} onClose={() => setScreenOpen(null)}
        onOpenAsTab={(deviceId) => { setScreenOpen(null); openScreen(deviceId, focusedIdRef.current); }} />}
      {palette && (
        <Switcher
          initialScope={palette}
          items={switchItems}
          tabGroups={paletteTabGroups}
          commands={paletteCommandList()}
          approval={approval.pending ? { cmd: approval.pending.cmd } : null}
          waitingOnly={paletteWaiting}
          onPick={openWindow}
          onPickTab={(leafId, tabId) => { setFocusedId(leafId); activate(tabId); }}
          onApproval={openApproval}
          onShortcuts={() => setShortcutsOpen(true)}
          onClose={() => { setPalette(null); setPaletteWaiting(false); }}
        />
      )}
      {tabSheetOpen && phone && <TabSheet
        groups={paletteTabGroups}
        workspaces={phone.workspaces}
        activeWorkspace={phone.activeWorkspace}
        connection={phone.connection}
        connectionBad={phone.connectionBad}
        onSearch={() => { setTabSheetOpen(false); setPaletteWaiting(false); setPalette('terminal'); }}
        onConnection={() => { setTabSheetOpen(false); phone.openConnection(); }}
        onSelectWorkspace={id => { setTabSheetOpen(false); phone.selectWorkspace(id); }}
        onNewWorkspace={() => { setTabSheetOpen(false); workspace?.create(); }}
        onWorkspaceMenu={(id, x, y) => { setTabSheetOpen(false); phone.openWorkspaceMenu(id, x, y); }}
        onPickTab={(leafId, tabId) => { setTabSheetOpen(false); setFocusedId(leafId); activate(tabId); }}
        onTabMenu={(tabId, x, y) => { setTabSheetOpen(false); openTabMenu(tabId, { x, y }); }}
        onClose={() => setTabSheetOpen(false)}
      />}
      {shortcutsOpen && <Shortcuts altKeys={altKeys} onClose={() => setShortcutsOpen(false)} />}


      {dialog && <Dialog spec={dialog} onClose={() => setDialog(null)} />}

      <div className="toasts">
        {/* 承認待ちの検知など、すぐ伝えるものは assertive で読み上げる */}
        <div className="toast-list" role="alert" aria-live="assertive">
          {toasts.filter((t) => t.urgent).map((t) => (
            <div key={t.id} className={`toast ${t.kind} has-action`}>
              <button className="toast-text" title="クリックで閉じる"
                onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}>{t.text}</button>
              {t.action && <button className="toast-action" onClick={() => { setToasts((list) => list.filter((x) => x.id !== t.id)); t.action!.run(); }}>{t.action.label}</button>}
            </div>
          ))}
        </div>
        <div className="toast-list" role="status" aria-live="polite">
        {toasts.filter((t) => !t.urgent).map((t) => t.action ? (
          <div key={t.id} className={`toast ${t.kind} has-action`}>
            <button
              className="toast-text"
              title="クリックで閉じる"
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
            >
              {t.text}
            </button>
            <button className="toast-action" onClick={t.action.run}>{t.action.label}</button>
          </div>
        ) : (
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
    </div>
  );
}
