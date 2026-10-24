import { InstallApp } from './components/InstallApp';
import { useCallback, useEffect, useRef, useState } from 'react';
import App from './App';
import { flushSync } from 'react-dom';
import type { DragPayload } from './components/SplitView';
import { Icon } from './components/Icon';
import { newId } from './layout';
import { useTmuxState } from './api';
import { Dialog, type DialogSpec } from './components/Dialog';
import { addDesktop, desktopKey, INITIAL_DESKTOPS, removeDesktop, restoreDesktops, transferDesktopTab, type DesktopLayoutRegistry, type Desktops as DesktopState } from './desktops';

export default function Desktops() {
  const connection = useTmuxState();
  const [state, setState] = useState<DesktopState>(() => {
    try { return restoreDesktops(JSON.parse(localStorage.getItem('tw.desktops') || 'null')); }
    catch { return INITIAL_DESKTOPS; }
  });
  const [visited, setVisited] = useState(() => new Set([state.activeId]));
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const desktopLayouts = useRef<DesktopLayoutRegistry>(new Map());
  const [dropDesktopId, setDropDesktopId] = useState<string | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
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

  const current = state.items.find(item => item.id === state.activeId)!;
  useEffect(() => { try { localStorage.setItem('tw.desktops', JSON.stringify(state)); } catch { /* storage unavailable */ } }, [state]);
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
    try { localStorage.setItem(desktopKey(id, 'tw.layout'), 'null'); } catch { /* storage unavailable */ }
    setVisited(prev => new Set([...prev, id]));
    setState(prev => addDesktop(prev, id));
  };
  const rename = (desktop = current) => setDialog({ kind: 'prompt', title: 'デスクトップの名前を変更', defaultValue: desktop.name, confirmLabel: '変更', onSubmit: name => {
    if (name.trim()) setState(prev => ({ ...prev, items: prev.items.map(item => item.id === desktop.id ? { ...item, name: name.trim().slice(0, 60) } : item) }));
  } });
  const remove = (id: string) => {
    const item = state.items.find(item => item.id === id);
    if (!item || state.items.length === 1) return;
    setDialog({ kind: 'confirm', title: `「${item.name}」を削除しますか？`, detail: 'このデスクトップのタブ・分割配置を削除します。tmuxと実行中の処理は継続し、他のデスクトップから再び開けます。', confirmLabel: '配置を削除', danger: false, onSubmit: () => {
      const next = removeDesktop(state, id);
      setVisited(prev => new Set([...prev, next.activeId]));
      setState(next);
      for (const key of ['tw.layout', 'tw.serverPid', 'tw.device', 'tw.focusedLeaf']) try { localStorage.removeItem(desktopKey(id, key)); } catch { /* storage unavailable */ }
    } });
  };
  useEffect(() => {
    const button = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!button || !list.current) return;
    const parent = list.current.getBoundingClientRect(); const child = button.getBoundingClientRect();
    if (child.left < parent.left) list.current.scrollLeft -= parent.left - child.left;
    else if (child.right > parent.right) list.current.scrollLeft += child.right - parent.right;
  }, [state.activeId]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || dialog || document.querySelector('dialog[open], [aria-modal="true"], .modal-backdrop')) return;
      if (event.code === 'KeyN') { event.preventDefault(); event.stopImmediatePropagation(); create(); return; }
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const index = state.items.findIndex(item => item.id === state.activeId);
      const next = state.items[(index + (event.key === 'ArrowLeft' ? -1 : 1) + state.items.length) % state.items.length];
      select(next.id);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [state, dialog]);
  return <div className="desktop-shell">
    <header className="desktop-bar">
      <div className="desktop-tabs" role="tablist" aria-label="仮想デスクトップ" ref={list}>
        {state.items.map((desktop, index) => <div className="desktop-slot" key={desktop.id}>
          <button id={`desktop-tab-${desktop.id}`} data-desktop-id={desktop.id} className={`desktop-tab ${desktop.id === state.activeId ? 'on' : ''} ${dropDesktopId === desktop.id ? 'drop-target' : ''}`} role="tab" aria-selected={desktop.id === state.activeId}
            aria-controls={`desktop-panel-${desktop.id}`} tabIndex={desktop.id === state.activeId ? 0 : -1}
            title={`${desktop.name}（タブをドロップして移動・ダブルクリックで名前変更）`} onClick={() => select(desktop.id)}
            onDoubleClick={() => { select(desktop.id); rename(desktop); }}
            onKeyDown={e => {
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
      <InstallApp />
      <button className="desktop-rename" aria-label="現在のデスクトップの名前を変更" title="デスクトップの名前を変更" onClick={() => rename()}><Icon name="edit" /></button>
    </header>
    <div className="desktop-panels">
      {state.items.map(desktop => <section id={`desktop-panel-${desktop.id}`} key={desktop.id} className="desktop-panel" role="tabpanel"
        aria-labelledby={`desktop-tab-${desktop.id}`} hidden={desktop.id !== state.activeId}>
        {visited.has(desktop.id) && <App workspaceId={desktop.id} workspaceName={desktop.name} active={desktop.id === state.activeId} connection={connection} desktopLayouts={desktopLayouts.current} onDesktopDrag={startDesktopDrag} />}
      </section>)}
    </div>
    {dialog && <Dialog spec={dialog} onClose={() => setDialog(null)} />}
  </div>;
}
