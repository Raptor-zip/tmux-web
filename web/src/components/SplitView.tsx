import { Modal } from './Modal';
import { Icon } from './Icon';
import { deviceOf, type Device } from '../devices';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  activeTab,
  dividers,
  dropSideFor,
  leafRects,
  type DropSide,
  type LayoutNode,
  type Rect,
  type TabRef,
} from '../layout';
import { TabStrip } from './TabStrip';
import { TerminalView, type TerminalHandle } from './Terminal';
import type { Session, TmuxWindow } from '../types';
import type { WindowView } from '../windows';

/** サイドバーやタブから掴んだもの */
export interface DragPayload {
  /** session を掴んだときは windowId が null になり、代表ウィンドウが開かれる */
  kind: 'window' | 'session';
  sessionId: string;
  windowId: string | null;
  label: string;
  /** すでに開いているタブを掴んだ場合、その元タブの id。新規ではなく「移動」になる */
  fromTabId?: string | null;
}

/** ドラッグ中のものを落とせる場所 */
export type DropTarget =
  | { kind: 'split'; leafId: string; side: Exclude<DropSide, 'center'> }
  | { kind: 'tab'; leafId: string; before: string | null };

interface Props {
  actions: ReactNode;
  active: boolean;
  devices: Device[];
  tree: LayoutNode;
  statuses: Record<string, {connected:boolean;message?:string}>;
  focusMode: boolean;
  onToggleFocus(): void;
  focusedId: string | null;
  sessions: Session[];
  windows: TmuxWindow[];
  /** ウィンドウ id → 表示に使う情報 */
  views: Map<string, WindowView>;
  mode: 'mirror' | 'direct';
  showStatusBar: boolean;
  fontSize: number;
  lineHeight: number;
  /** ドラッグ中のもの。null ならドラッグしていない */
  drag: DragPayload | null;
  /**
   * tmux が入れ替わって、配置を繋ぎ直している最中。
   * 覚えている id は別のセッションを指しているので、繋ぎ直しが済むまで attach しない。
   */
  pendingRemap: boolean;
  onFocus(leafId: string): void;
  onActivateTab(tabId: string): void;
  onCloseTab(tabId: string): void;
  onCloseTile(leafId: string): void;
  onNewTab(leafId: string, deviceId?: string): void;
  onDrop(target: DropTarget, payload: DragPayload): void;
  onStartDrag(payload: DragPayload): void;
  onDragEnd(): void;
  onRatio(splitId: string, ratio: number): void;
  onStatus(leafId: string, status: { connected: boolean; message?: string }): void;
  /** 端末で選択した内容がクリップボードに入った */
  onCopied(text: string): void;
  onTerminalContextMenu(leafId: string, x: number, y: number): void;
  onTabContextMenu(tabId: string, x: number, y: number): void;
  registerTerm(leafId: string, handle: TerminalHandle | null): void;
}

const pct = (r: Rect) => ({
  left: `${r.left}%`,
  top: `${r.top}%`,
  width: `${r.width}%`,
  height: `${r.height}%`,
});

/** ドロップ先のプレビュー矩形（タイルのどこに入るかを見せる） */
function previewRect(rect: Rect, side: Exclude<DropSide, 'center'>): Rect {
  switch (side) {
    case 'left':
      return { ...rect, width: rect.width / 2 };
    case 'right':
      return { ...rect, left: rect.left + rect.width / 2, width: rect.width / 2 };
    case 'top':
      return { ...rect, height: rect.height / 2 };
    default:
      return { ...rect, top: rect.top + rect.height / 2, height: rect.height / 2 };
  }
}

export function SplitView({
  active,
  devices,
  actions,
  tree,
  focusMode,
  statuses,
  onToggleFocus,
  focusedId,
  sessions,
  windows,
  views,
  mode,
  showStatusBar,
  fontSize,
  lineHeight,
  drag,
  pendingRemap,
  onFocus,
  onActivateTab,
  onCloseTab,
  onCloseTile,
  onNewTab,
  onDrop,
  onStartDrag,
  onDragEnd,
  onRatio,
  onStatus,
  onCopied,
  onTerminalContextMenu,
  onTabContextMenu,
  registerTerm,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [dropAt, setDropAt] = useState<DropTarget | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);

  const [forceSplit, setForceSplit] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [retries, setRetries] = useState<Record<string,number>>({});
  const [size, setSize] = useState({width: 0, height: 0});
  const [overview, setOverview] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => { setSize({width:entry.contentRect.width,height:entry.contentRect.height}); setForceSplit(false); });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const tiles = useMemo(() => leafRects(tree), [tree]);
  const bars = useMemo(() => dividers(tree), [tree]);
  const closableTile = tiles.length > 1;
  const autoFocus = size.width > 0 && (window.innerWidth <= 760 || tiles.some(t => size.width * t.rect.width / 100 < 280 || size.height * t.rect.height / 100 < 160));
  const single = closableTile && (focusMode || (!resizing && autoFocus && (!forceSplit || window.innerWidth <= 760)));
  const selectedId = tiles.some(t => t.leaf.id === focusedId) ? focusedId : tiles[0]?.leaf.id;
  const openOverview = () => { setQuery(''); setOverview(true); };

  /** タブが映しているウィンドウ。windowId が null のタブはセッションのアクティブを見る */
  const viewOf = useCallback(
    (tab: TabRef) => {
      const session = sessions.find((s) => s.id === tab.sessionId) ?? null;
      const win = tab.windowId
        ? windows.find((w) => w.id === tab.windowId)
        : windows.find((w) => w.sessionId === tab.sessionId && w.active);
      return { view: win ? views.get(win.id) ?? null : null, session, device: devices.find(d => d.id === deviceOf(tab.sessionId)) };
    },
    [sessions, windows, views, devices],
  );

  /**
   * カーソルの下に何があるかを求める。
   *
   * タブ列の上なら差し込み位置、そうでなければタイルのどの辺か。タブの当たり判定は
   * 実際の DOM に聞く（elementsFromPoint はドラッグ用の面の下にあるものまで返す）。
   * 矩形を自前で持たないので、タブ列が横スクロールしていてもずれない。
   */
  const hitTest = useCallback(
    (clientX: number, clientY: number): DropTarget | null => {
      const stack = document
        .elementsFromPoint(clientX, clientY)
        .filter((el): el is HTMLElement => el instanceof HTMLElement);

      const tabEl = stack.find((el) => el.dataset.tabId);
      const stripEl = stack.find((el) => el.dataset.stripLeaf);
      if (tabEl && stripEl) {
        const ids = [...stripEl.querySelectorAll<HTMLElement>('[data-tab-id]')].map(
          (el) => el.dataset.tabId as string,
        );
        const at = ids.indexOf(tabEl.dataset.tabId as string);
        const r = tabEl.getBoundingClientRect();
        const after = clientX > r.left + r.width / 2;
        return {
          kind: 'tab',
          leafId: stripEl.dataset.stripLeaf as string,
          before: after ? ids[at + 1] ?? null : ids[at],
        };
      }
      if (stripEl) {
        return { kind: 'tab', leafId: stripEl.dataset.stripLeaf as string, before: null };
      }

      const host = hostRef.current;
      if (!host) return null;
      const box = host.getBoundingClientRect();
      const x = ((clientX - box.left) / box.width) * 100;
      const y = ((clientY - box.top) / box.height) * 100;
      if (single) return selectedId ? {kind:'tab',leafId:selectedId,before:null} : null;
      const hit = tiles.find(
        ({ rect }) =>
          x >= rect.left &&
          x < rect.left + rect.width &&
          y >= rect.top &&
          y < rect.top + rect.height,
      );
      if (!hit) return null;
      const side = dropSideFor(x - hit.rect.left, y - hit.rect.top, hit.rect.width, hit.rect.height);
      return side === 'center'
        ? { kind: 'tab', leafId: hit.leaf.id, before: null }
        : { kind: 'split', leafId: hit.leaf.id, side };
    },
    [tiles, single, selectedId],
  );

  const startDividerDrag = useCallback(
    (e: React.PointerEvent, split: { id: string; dir: 'row' | 'column'; parent: Rect }) => {
      e.preventDefault();
      const host = hostRef.current;
      if (!host) return;
      const box = host.getBoundingClientRect();
      setResizing(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const move = (ev: PointerEvent) => {
        // 親分割の矩形内でカーソルがどこにあるかを 0..1 に直す
        const ratio =
          split.dir === 'row'
            ? ((ev.clientX - box.left) / box.width) * 100
            : ((ev.clientY - box.top) / box.height) * 100;
        const origin = split.dir === 'row' ? split.parent.left : split.parent.top;
        const size = split.dir === 'row' ? split.parent.width : split.parent.height;
        if (size > 0) onRatio(split.id, (ratio - origin) / size);
      };
      const up = (ev: PointerEvent) => {
        if ((e.target as HTMLElement).hasPointerCapture(ev.pointerId)) (e.target as HTMLElement).releasePointerCapture(ev.pointerId);
        setResizing(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [onRatio],
  );

  return (
    <div className={`panel-workspace ${single ? 'single-panel' : ''}`}>
    <div className="splitview" ref={hostRef}>

      {tiles.map(({ leaf, rect }) => {
        const tab = activeTab(leaf);
        const { view, device } = tab ? viewOf(tab) : { view: null, device: undefined };
        const status = statuses[leaf.id];
        const focused = leaf.id === selectedId;
        const tabDrop = dropAt?.kind === 'tab' && dropAt.leafId === leaf.id;

        return (
          <div
            key={leaf.id}
            className={`tile ${focused ? 'focused' : ''} ${tabDrop ? 'drop-tab' : ''}`}
            style={single && focused ? {left:0,top:0,width:'100%',height:'100%'} : pct(rect)}
            hidden={single && !focused}
            onFocusCapture={() => onFocus(leaf.id)}
            onPointerDown={() => onFocus(leaf.id)}
          >
            <TabStrip
              actions={focused ? actions : null}
              leaf={leaf}
              onOverview={openOverview}
              onToggleFocus={() => {
                onFocus(leaf.id);
                if (single) {
                  if (focusMode) onToggleFocus();
                  setForceSplit(true);
                } else {
                  setForceSplit(false);
                  onToggleFocus();
                }
              }}
              focused={focused}
              devices={devices}
              viewOf={viewOf}
              closableTile={closableTile}
              draggingTabId={drag?.fromTabId ?? null}
              caret={tabDrop ? dropAt.before : undefined}
              onActivate={(id) => {
                onFocus(leaf.id);
                onActivateTab(id);
              }}
              onClose={onCloseTab}
              onCloseTile={() => onCloseTile(leaf.id)}
              onNewTab={(deviceId) => onNewTab(leaf.id, deviceId)}
              onStartDrag={onStartDrag}
              onContextMenu={onTabContextMenu}
            />

            <div className="tile-body">
              {tab ? (
                <TerminalView
                  ref={(h) => registerTerm(leaf.id, h)}
                  retryToken={retries[leaf.id] || 0}
                  sessionId={pendingRemap || !active || (single && !focused) ? null : tab.sessionId}
                  windowId={tab.windowId}
                  windowIndex={view?.win.index ?? null}
                  mode={mode}
                  showStatusBar={showStatusBar}
                  fontSize={fontSize}
                  lineHeight={lineHeight}
                  onContextMenu={(x, y) => onTerminalContextMenu(leaf.id, x, y)}
                  onStatus={(s) => onStatus(leaf.id, s)}
                  onCopied={onCopied}
                />
              ) : null}
              {status && !status.connected && <div className="panel-connection" role="status"><strong>{device?.name || '端末'} · 未接続</strong><span>{status.message || '接続を確認しています…'}</span><button onClick={()=>setRetries(v=>({...v,[leaf.id]:(v[leaf.id]||0)+1}))}>再接続</button></div>}
            </div>
          </div>
        );
      })}

      {!single && bars.map((d) => (
        <div
          key={d.id}
          className={`divider ${d.dir}`}
          style={
            d.dir === 'row'
              ? { left: `${d.rect.left}%`, top: `${d.rect.top}%`, height: `${d.rect.height}%` }
              : { top: `${d.rect.top}%`, left: `${d.rect.left}%`, width: `${d.rect.width}%` }
          }
          onPointerDown={(e) => startDividerDrag(e, d)}
        />
      ))}

      {/* ドラッグ中だけ前面に出る当たり判定用の面。マウスでもタッチでも同じ経路で動く */}
      {drag && (
        <div
          className="drag-catcher"
          onPointerMove={(e) => {
            setGhost({ x: e.clientX, y: e.clientY });
            setDropAt(hitTest(e.clientX, e.clientY));
          }}
          onPointerUp={(e) => {
            const target = hitTest(e.clientX, e.clientY);
            setDropAt(null);
            setGhost(null);
            if (target) onDrop(target, drag);
            onDragEnd();
          }}
          onPointerCancel={() => {
            setDropAt(null);
            setGhost(null);
            onDragEnd();
          }}
        />
      )}

      {drag && dropAt?.kind === 'split' && (
        <div
          className="drop-preview"
          style={pct(
            previewRect(
              tiles.find((t) => t.leaf.id === dropAt.leafId)?.rect ?? {
                left: 0,
                top: 0,
                width: 100,
                height: 100,
              },
              dropAt.side,
            ),
          )}
        >
          <span>ここに並べる</span>
        </div>
      )}

      {drag && ghost && (
        <div className="drag-ghost" style={{ left: ghost.x, top: ghost.y }}>
          {drag.label}
        </div>
      )}
    </div>
    {overview && <Modal title="タブ・パネル" className="panel-overview" onClose={()=>setOverview(false)}>
      <div className="overview-search"><input aria-label="タブを検索" placeholder="プロジェクト・デバイス・作業名で検索" value={query} onChange={e=>setQuery(e.target.value)} /></div>
      <div className="overview-list">
      {tiles.map(({leaf},index) => {
        const matches = leaf.tabs.filter(tab => { const {view,device}=viewOf(tab); return [view?.project, view?.primary, tab.sessionName,device?.name].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()); });
        if (!matches.length) return null;
        return <section key={leaf.id}><h3>パネル {index+1}{leaf.id===selectedId ? ' · 入力先' : ''}<span>{leaf.tabs.length} タブ</span></h3>
          {matches.map(tab=>{const {view,device}=viewOf(tab);return <button key={tab.id} className="overview-tab" aria-current={tab.id===leaf.activeId && leaf.id===selectedId ? 'true' : undefined} onClick={()=>{onFocus(leaf.id);onActivateTab(tab.id);setOverview(false);if (!window.matchMedia('(any-pointer: coarse)').matches) requestAnimationFrame(()=>hostRef.current?.querySelector<HTMLTextAreaElement>('.tile.focused textarea')?.focus());}}>
            <span className="overview-device">{device?.name || '接続先を確認中'}{device && !device.connected ? ' · 未接続' : ''}</span>
            <strong>{view?.project || tab.sessionName}</strong><span className="overview-task">{view?.primary || tab.windowName || '端末'}</span><span className="overview-selected">{tab.id===leaf.activeId && leaf.id===selectedId ? '選択中' : '開く →'}</span>
          </button>;})}</section>;
      })}
      {!tiles.some(({leaf})=>leaf.tabs.some(tab=>{const {view,device}=viewOf(tab);return [view?.project,view?.primary,tab.sessionName,device?.name].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase());})) && <p className="overview-empty">一致するタブがありません</p>}
      </div>
    </Modal>}
    </div>
  );
}
