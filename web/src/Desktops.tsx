import { ContextMenu } from './components/ContextMenu';
import { buildMenu } from './commands';
import { DESKTOP_MENU } from './menus';
import { ScreenViewer } from './components/ScreenViewer';
import { InstallApp } from './components/InstallApp';
import { useCallback, useEffect, useRef, useState } from 'react';
import App from './App';
import { flushSync } from 'react-dom';
import type { DragPayload } from './components/SplitView';
import { Icon } from './components/Icon';
import { useWorkspaceStatus, useWorkspaceValue, workspaceStore } from './workspace-store';
import { newId } from './layout';
import { useTmuxState } from './api';
import { Dialog, type DialogSpec } from './components/Dialog';
import { useSharedSetting } from './shared-setting';
import { useLongPress } from './hooks/useLongPress';
import { ConnectionStatus, connectionLabel } from './components/ConnectionStatus';
import { Devices } from './components/Devices';
import { addDesktop, desktopKey, INITIAL_DESKTOPS, openScreenTab, removeDesktop, restoreDesktops, transferDesktopTab, type DesktopLayoutRegistry, type Desktops as DesktopState } from './desktops';

export default function Desktops() {
  const connection = useTmuxState();
  const sync = useWorkspaceStatus();
  useEffect(() => {
    workspaceStore.start();
    const wake = () => { if (document.visibilityState !== 'hidden') workspaceStore.reconnect(); };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      workspaceStore.stop();
    };
  }, []);
  if (!sync.ready) return <div className="workspace-loading" role="status">
    <p>{connection.unauthorized ? 'Tailscale認証を確認してください。' : 'デスクトップの配置を同期しています…'}</p>
    <p>{sync.error}</p>
    {connection.unauthorized && connection.authUrl && <a href={connection.authUrl}>接続先を開く</a>}
    <button onClick={() => workspaceStore.reconnect()}>再接続</button>
  </div>;
  return <SyncedDesktops connection={connection} />;
}

function SyncedDesktops({ connection }: { connection: ReturnType<typeof useTmuxState> }) {
  const sync = useWorkspaceStatus();
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  /** 上バーの差し込み口。表示中のワークスペースの App が ≡・入力待ち・承認待ち・⌕ をここへ描く */
  const [leadSlot, setLeadSlot] = useState<HTMLElement | null>(null);
  const [statusSlot, setStatusSlot] = useState<HTMLElement | null>(null);
  const [trailSlot, setTrailSlot] = useState<HTMLElement | null>(null);
  const [state, setState] = useWorkspaceValue<DesktopState>('tw.desktops', INITIAL_DESKTOPS, restoreDesktops);
  const [visited, setVisited] = useState(() => new Set([state.activeId]));
  useEffect(() => { setVisited(prev => prev.has(state.activeId) ? prev : new Set([...prev, state.activeId])); }, [state.activeId]);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // タッチの長押し（550ms・8px 以内・1 本指）でワークスペースのメニューを開く
  const longPress = useLongPress<string>((id, { x, y }) => setTabMenu({ id, x, y }));
  const cancelPress = longPress.cancel;
  const desktopLayouts = useRef<DesktopLayoutRegistry>(new Map());
  const [dropDesktopId, setDropDesktopId] = useState<string | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const moveDesktopTab = useCallback((sourceId: string, tabId: string, destinationId: string) => {
    const source = desktopLayouts.current.get(sourceId);
    const sourceState = source?.read();
    if (!source || !sourceState?.layout) return;
    flushSync(() => setVisited(prev => new Set([...prev, destinationId])));
    const destination = desktopLayouts.current.get(destinationId);
    if (!destination) return;
    const target = destination.read();
    const result = transferDesktopTab(sourceState.layout, target.layout, tabId, target.focusedId);
    if (!result) return;
    source.write(result.source, sourceState.focusedId);
    destination.write(result.destination, result.focusedId);
    setState(prev => ({ ...prev, activeId: destinationId }));
  }, []);
  const startDesktopDrag = useCallback((sourceId: string, payload: DragPayload, endSource: () => void) => {
    dragCleanup.current?.();
    if (!payload.fromTabId) return;
    const hit = (event: PointerEvent) => {
      const button = document.elementsFromPoint(event.clientX, event.clientY)
        .map(el => el.closest<HTMLElement>('[data-desktop-id]')).find(Boolean);
      const id = button?.dataset.desktopId;
      return id && id !== sourceId ? id : null;
    };
    const move = (event: PointerEvent) => setDropDesktopId(hit(event));
    const cleanup = () => {
      setDropDesktopId(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop, true);
      window.removeEventListener('pointercancel', cleanup);
      window.removeEventListener('keydown', cancel, true);
      window.removeEventListener('blur', abort);
      dragCleanup.current = null;
    };
    const abort = () => { cleanup(); endSource(); };
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); abort(); }
    };
    const drop = (event: PointerEvent) => {
      const destinationId = hit(event);
      cleanup();
      if (!destinationId) return;
      const source = desktopLayouts.current.get(sourceId);
      const sourceState = source?.read();
      if (!source || !sourceState?.layout) return;
      // Mount an unvisited desktop before reading its saved layout.
      flushSync(() => setVisited(prev => new Set([...prev, destinationId])));
      const destination = desktopLayouts.current.get(destinationId);
      if (!destination) return;
      const target = destination.read();
      const result = transferDesktopTab(sourceState.layout, target.layout, payload.fromTabId!, target.focusedId);
      if (!result) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      endSource();
      source.write(result.source, sourceState.focusedId);
      destination.write(result.destination, result.focusedId);
      setState(prev => ({ ...prev, activeId: destinationId }));
    };
    dragCleanup.current = abort;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop, true);
    window.addEventListener('pointercancel', cleanup);
    window.addEventListener('keydown', cancel, true);
    window.addEventListener('blur', abort);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => { if (viewport.scale === 1) document.documentElement.style.setProperty('--app-height', `${viewport.height}px`); };
    update(); viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('pageshow', update);
    window.addEventListener('resize', update);
    return () => { viewport.removeEventListener('scroll', update); window.removeEventListener('pageshow', update); window.removeEventListener('resize', update); viewport.removeEventListener('resize', update); document.documentElement.style.removeProperty('--app-height'); };
  }, []);
  const select = (id: string) => {
    setVisited(prev => new Set([...prev, id]));
    setState(prev => ({ ...prev, activeId: id }));
  };
  const create = () => {
    const id = newId('desktop');
    // 新しい画面は自動で既存の端末を開かず、空の状態から使い始める。
    workspaceStore.set(desktopKey(id, 'tw.layout'), 'null');
    setVisited(prev => new Set([...prev, id]));
    setState(prev => addDesktop(prev, id));
  };
  const rename = (desktop: DesktopState['items'][number]) => setDialog({ kind: 'prompt', title: 'デスクトップの名前を変更', defaultValue: desktop.name, confirmLabel: '変更', onSubmit: name => {
    if (name.trim()) setState(prev => ({ ...prev, items: prev.items.map(item => item.id === desktop.id ? { ...item, name: name.trim().slice(0, 60) } : item) }));
  } });
  const remove = (id: string) => {
    const item = state.items.find(item => item.id === id);
    if (!item || state.items.length === 1) return;
    setDialog({ kind: 'confirm', title: `「${item.name}」を削除しますか？`, detail: 'このデスクトップのタブ・分割配置を削除します。tmuxと実行中の処理は継続し、他のデスクトップから再び開けます。', confirmLabel: '配置を削除', danger: false, onSubmit: () => {
      setState(prev => removeDesktop(prev, id));
      for (const key of ['tw.layout', 'tw.serverPid', 'tw.device', 'tw.focusedLeaf']) workspaceStore.set(desktopKey(id, key), null);
    } });
  };
  useEffect(() => {
    const button = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!button || !list.current) return;
    const parent = list.current.getBoundingClientRect(); const child = button.getBoundingClientRect();
    if (child.left < parent.left) list.current.scrollLeft -= parent.left - child.left;
    else if (child.right > parent.right) list.current.scrollLeft += child.right - parent.right;
  }, [state.activeId]);
  // tw.altKeys がオフなら、ワークスペースの Alt+Shift 操作も奪わず端末へ渡す
  const [altKeys] = useSharedSetting('tw.altKeys', true);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!altKeys || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || dialog || document.querySelector('dialog[open], [aria-modal="true"], .modal-backdrop, [role="menu"]')) return;
      if (event.code === 'KeyN') { event.preventDefault(); event.stopImmediatePropagation(); create(); return; }
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const index = state.items.findIndex(item => item.id === state.activeId);
      const next = state.items[(index + (event.key === 'ArrowLeft' ? -1 : 1) + state.items.length) % state.items.length];
      select(next.id);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [altKeys, state, dialog]);
  return <div className="desktop-shell">
    <header className="desktop-bar">
      <span className="bar-slot" ref={setLeadSlot} />
      <div className="desktop-tabs" role="tablist" aria-label="仮想デスクトップ" ref={list} onScroll={cancelPress}>
        {state.items.map((desktop, index) => <div className="desktop-slot" key={desktop.id}>
          <button id={`desktop-tab-${desktop.id}`} data-desktop-id={desktop.id} className={`desktop-tab ${desktop.id === state.activeId ? 'on' : ''} ${dropDesktopId === desktop.id ? 'drop-target' : ''}`} role="tab" aria-selected={desktop.id === state.activeId}
            aria-controls={`desktop-panel-${desktop.id}`} tabIndex={desktop.id === state.activeId ? 0 : -1}
            title={`${desktop.name}（右クリック・長押しで名前変更）`} aria-haspopup="menu" aria-expanded={tabMenu?.id === desktop.id}
            {...longPress.bind(desktop.id)}
            onClick={() => select(desktop.id)}
            onContextMenu={e => {
              e.preventDefault(); cancelPress();
              const box = e.currentTarget.getBoundingClientRect();
              setTabMenu({ id: desktop.id, x: e.clientX || box.left, y: e.clientY || box.bottom });
            }}
            onDoubleClick={() => { select(desktop.id); rename(desktop); }}
            onKeyDown={e => {
              if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                e.preventDefault();
                const box = e.currentTarget.getBoundingClientRect();
                setTabMenu({ id: desktop.id, x: box.left, y: box.bottom });
                return;
              }
              let next: number;
              if (e.key === 'ArrowRight') next = (index + 1) % state.items.length;
              else if (e.key === 'ArrowLeft') next = (index - 1 + state.items.length) % state.items.length;
              else if (e.key === 'Home') next = 0;
              else if (e.key === 'End') next = state.items.length - 1;
              else return;
              e.preventDefault(); select(state.items[next].id);
              list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            }}><span className="desktop-number">{index + 1}</span><span>{desktop.name}</span></button>
          {state.items.length > 1 && <button className="desktop-close" aria-label={`${desktop.name} を削除`} title="デスクトップの配置を削除" onClick={() => remove(desktop.id)}><Icon name="close" /></button>}
        </div>)}
      </div>
      <button className="desktop-add" aria-label="デスクトップを追加" title="デスクトップを追加 (Alt+Shift+N)" onClick={create}><Icon name="plus" /></button>
      <button className="remote-desktop-launch" aria-label="リモートデスクトップ" title="リモートデスクトップ" onClick={() => setRemoteOpen(true)}><Icon name="screen" /></button>
      <InstallApp />
      <span className="bar-slot bar-status" ref={setStatusSlot} />
      <ConnectionStatus
        label={connectionLabel({ connected: connection.connected, unauthorized: connection.unauthorized, hasState: !!connection.state, syncOk: sync.connected && !sync.error })}
        devices={connection.devices}
        syncError={sync.error || (!sync.connected ? '再接続中…' : undefined)}
        authUrl={connection.authUrl}
        version={connection.state?.server?.version}
        onReconnect={() => { connection.reconnect(); workspaceStore.reconnect(); }}
        onManageDevices={() => setDevicesOpen(true)} />
      <span className="bar-slot" ref={setTrailSlot} />
    </header>
    <div className="desktop-panels">
      {state.items.map(desktop => <section id={`desktop-panel-${desktop.id}`} key={desktop.id} className="desktop-panel" role="tabpanel"
        aria-labelledby={`desktop-tab-${desktop.id}`} hidden={desktop.id !== state.activeId}>
        {(visited.has(desktop.id) || desktop.id === state.activeId) && <App workspaceId={desktop.id} workspaceName={desktop.name} active={desktop.id === state.activeId} connection={connection} desktopLayouts={desktopLayouts.current} onDesktopDrag={startDesktopDrag} desktopTargets={state.items} onMoveDesktopTab={moveDesktopTab}
          barSlots={desktop.id === state.activeId ? { leading: leadSlot, status: statusSlot, trailing: trailSlot } : undefined} />}
      </section>)}
    </div>
    {tabMenu && <ContextMenu x={tabMenu.x} y={tabMenu.y} title={state.items.find(item => item.id === tabMenu.id)?.name} onClose={() => setTabMenu(null)} items={buildMenu(DESKTOP_MENU, { desktop: { rename: () => {
      const desktop = state.items.find(item => item.id === tabMenu.id);
      if (desktop) rename(desktop);
    } } })} />}
    {remoteOpen && <ScreenViewer devices={connection.devices} deviceId="local" onClose={() => setRemoteOpen(false)} onOpenAsTab={deviceId => {
      // 同じ画面を二重に繋がないよう、ダイアログを閉じてから今のデスクトップのタブに開く
      setRemoteOpen(false);
      const handle = desktopLayouts.current.get(state.activeId);
      if (!handle) return;
      const current = handle.read();
      const next = openScreenTab(current.layout, deviceId, current.focusedId);
      handle.write(next.layout, next.focusedId);
    }} />}
    {devicesOpen && <Devices devices={connection.devices} onChanged={connection.reloadDevices} onClose={() => setDevicesOpen(false)} />}
    {dialog && <Dialog spec={dialog} onClose={() => setDialog(null)} />}
  </div>;
}
