import { ContextMenu, SEP, type MenuEntry } from './ContextMenu';
import type { Device } from '../devices';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { DragPayload } from './SplitView';
import type { LeafNode, TabRef } from '../layout';
import type { Session } from '../types';
import { whereWithSession, type WindowView } from '../windows';

interface Props {
  devices: Device[];
  leaf: LeafNode;
  focused: boolean;
  /** タブ id → 表示に使う情報。tmux 側に無いタブは undefined になる */
  viewOf(tab: TabRef): { view: WindowView | null; session: Session | null; device?: Device };
  /** タイルが 2 枚以上ある＝タイルごと閉じられる */
  closableTile: boolean;
  /** ドラッグ中のタブ id（掴んでいる本人を薄くする） */
  draggingTabId: string | null;
  /**
   * 差し込み位置の目印。undefined = このタイルは落とし先ではない、
   * null = 末尾、文字列 = そのタブの手前
   */
  caret?: string | null;
  onOverview(): void;
  onToggleFocus(): void;
  onActivate(tabId: string): void;
  onClose(tabId: string): void;
  onCloseTile(): void;
  onNewTab(deviceId?: string): void;
  onStartDrag(payload: DragPayload): void;
  onContextMenu(tabId: string, x: number, y: number): void;
}

/**
 * タイルの上に並ぶタブ。1 タブ = tmux のウィンドウ 1 つ。
 *
 * ブラウザのタブと同じ操作にしてある（クリックで切り替え・中クリックで閉じる・
 * 掴んで並べ替え／別のタイルへ移動・空きをダブルクリックで新しい端末）。
 */
export function TabStrip({
  devices,
  leaf,
  focused,
  viewOf,
  closableTile,
  draggingTabId,
  caret,
  onOverview,
  onToggleFocus,
  onActivate,
  onClose,
  onCloseTile,
  onNewTab,
  onStartDrag,
  onContextMenu,
}: Props) {
  const [menu, setMenu] = useState<{x:number;y:number;items:MenuEntry[]} | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 前面のタブが隠れていたら見える位置まで送る（キーボードで切り替えたときに要る）
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('.tab.active');
    if (!list || !el) return;
    const box = list.getBoundingClientRect();
    const tabBox = el.getBoundingClientRect();
    if (tabBox.left < box.left) list.scrollLeft -= box.left - tabBox.left;
    else if (tabBox.right > box.right) list.scrollLeft += tabBox.right - box.right;
  }, [leaf.activeId, leaf.tabs.length]);

  /** 押してから 6px 動いたらドラッグ開始。押しただけで動き出すと切り替えられない */
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const pending = useRef<{ x: number; y: number; payload: DragPayload } | null>(null);

  const armDrag = (e: React.PointerEvent, payload: DragPayload) => {
    // タッチは標準の横スクロールを使う。並べ替えはマウスで行う。
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    dragCleanup.current?.();
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
      dragCleanup.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
    };
    dragCleanup.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  };

  const step = (from: number, delta: number) => {
    const next = leaf.tabs[from + delta];
    if (next) {
      onActivate(next.id);
      requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[from + delta]?.focus());
    }
  };

  const mark = caret === undefined ? undefined : <span key="caret" className="tab-caret" />;

  return (
    <div className={`tabstrip ${focused ? 'focused' : ''}`} data-strip-leaf={leaf.id}>
      <div
        className="tablist"
        role="tablist"
        aria-label="このパネルの端末"
        ref={listRef}
        // 横に長いタブ列は、縦ホイールでも送れたほうが早い
        onWheel={(e) => {
          if (e.deltaX !== 0 || !listRef.current) return;
          listRef.current.scrollLeft += e.deltaY;
        }}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) onNewTab();
        }}
      >
        {leaf.tabs.map((tab, i) => {
          const { view, session, device } = viewOf(tab);
          const active = tab.id === leaf.activeId;
          const kind = view?.status.kind ?? 'idle';
          const label = view?.project || tab.sessionName || '—';
          const where = view ? whereWithSession(view, session) : '接続が切れました';
          return (
            <div key={tab.id} className="tab-slot">
              {caret === tab.id && mark}
              <div
                className={`tab st-${kind} ${active ? 'active' : ''} ${
                  draggingTabId === tab.id ? 'dragging' : ''
                }`}
                data-tab-id={tab.id}
                data-leaf-id={leaf.id}
                role="tab"
                tabIndex={active ? 0 : -1}
                aria-selected={active}
                title={[device?.name, view?.primary, where, view?.fullPath, view?.status.label]
                  .filter(Boolean)
                  .join('\n')}
                onPointerDown={(e) => {
                  // 中クリックはブラウザのオートスクロールが始まってしまう
                  if (e.button === 1) e.preventDefault();
                  if ((e.target as HTMLElement).closest('.tab-close')) return;
                  if (e.pointerType === 'mouse' && e.button === 0) onActivate(tab.id);
                  armDrag(e, {
                    kind: 'window',
                    sessionId: tab.sessionId,
                    windowId: tab.windowId,
                    label,
                    fromTabId: tab.id,
                  });
                }}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest('.tab-close')) onActivate(tab.id);
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onClose(tab.id);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onContextMenu(tab.id, e.clientX, e.clientY);
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') onActivate(tab.id);
                  else if (e.key === 'ArrowLeft') step(i, -1);
                  else if (e.key === 'ArrowRight') step(i, 1);
                  else if (e.key === 'Home') step(i, -i);
                  else if (e.key === 'End') step(i, leaf.tabs.length - 1 - i);
                  else if (e.key === 'Delete' || e.key === 'Backspace') onClose(tab.id);
                  else return;
                  e.preventDefault();
                }}
              >
                <span className={`state-dot ${kind}`} />
                <span className="tab-device" title={device?.error}><span className="device-full">{device?.name || "このPC"}</span><span className="device-short" aria-hidden="true">{device?.local ? "PC" : (device?.name || "接続先").replace(/[^A-Za-z0-9一-龯ぁ-んァ-ヶ]/g, "").slice(0,2).toUpperCase()}</span>{device && !device.connected ? " · 切断" : ""}</span>
                <span className="tab-caption"><span className="tab-name">{label}</span><span className="tab-task">{view?.primary || tab.windowName || "端末"}</span></span>
                <span className="tab-where">{where}</span>
                <button
                  className="tab-close"
                  aria-label={`${label} のタブを閉じる`}
                  title="タブを閉じる（中クリックでも閉じます）"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                >
                  <Icon name="close" />
                </button>
              </div>
            </div>
          );
        })}
        {caret === null && mark}
      </div>

      <div className="strip-tools">
        {leaf.tabs.length > 1 && <button className="strip-btn tab-count" title="このパネルのタブを一覧で見る" aria-label={`このパネルの${leaf.tabs.length}タブを一覧で見る`} onClick={onOverview}>{leaf.tabs.length}</button>}
        <button className="strip-btn" title="新しい端末を開く" aria-label="新しい端末をタブで開く" aria-haspopup="menu"
          onClick={e => { const r=e.currentTarget.getBoundingClientRect(); setMenu({x:r.left,y:r.bottom,items:[
            {label:'現在のデバイスで端末を開く',hint:'Alt+T',run:()=>onNewTab()},
            ...devices.map(d=>({label:`${d.name} で端末を開く`,disabled:!d.connected,run:()=>onNewTab(d.id)})),
          ]}); }}><Icon name="plus" /></button>
        <button className="strip-btn" title="パネルの操作" aria-label="パネルの操作" aria-haspopup="menu"
          onClick={e => {const r=e.currentTarget.getBoundingClientRect(); setMenu({x:r.right,y:r.bottom,items:[
            {label:'タブ・パネルの一覧',run:onOverview},
            {label:'このパネルを広げる / 元に戻す',hint:'Alt+Enter',run:onToggleFocus},
            {label:'選択中のタブの操作…',run:()=>onContextMenu(leaf.activeId,r.right,r.bottom)},
            ...(closableTile ? [SEP,{label:`このパネルを閉じる（${leaf.tabs.length}タブ）`,run:onCloseTile}] : []),
          ]}); }}><Icon name="more" /></button>
      </div>
      {menu && <ContextMenu {...menu} onClose={()=>setMenu(null)} />}
    </div>
  );
}
