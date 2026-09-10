import { useEffect, useRef } from 'react';
import type { DragPayload } from './SplitView';
import type { LeafNode, TabRef } from '../layout';
import type { Session } from '../types';
import { whereWithSession, type WindowView } from '../windows';

interface Props {
  leaf: LeafNode;
  focused: boolean;
  /** タブ id → 表示に使う情報。tmux 側に無いタブは undefined になる */
  viewOf(tab: TabRef): { view: WindowView | null; session: Session | null };
  /** タイルが 2 枚以上ある＝タイルごと閉じられる */
  closableTile: boolean;
  /** ドラッグ中のタブ id（掴んでいる本人を薄くする） */
  draggingTabId: string | null;
  /**
   * 差し込み位置の目印。undefined = このタイルは落とし先ではない、
   * null = 末尾、文字列 = そのタブの手前
   */
  caret?: string | null;
  onActivate(tabId: string): void;
  onClose(tabId: string): void;
  onCloseTile(): void;
  onNewTab(): void;
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
  leaf,
  focused,
  viewOf,
  closableTile,
  draggingTabId,
  caret,
  onActivate,
  onClose,
  onCloseTile,
  onNewTab,
  onStartDrag,
  onContextMenu,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  // 前面のタブが隠れていたら見える位置まで送る（キーボードで切り替えたときに要る）
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.tab.active');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [leaf.activeId, leaf.tabs.length]);

  /** 押してから 6px 動いたらドラッグ開始。押しただけで動き出すと切り替えられない */
  const pending = useRef<{ x: number; y: number; payload: DragPayload } | null>(null);

  const armDrag = (e: React.PointerEvent, payload: DragPayload) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
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
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  };

  const step = (from: number, delta: number) => {
    const next = leaf.tabs[from + delta];
    if (next) onActivate(next.id);
  };

  const mark = caret === undefined ? undefined : <span key="caret" className="tab-caret" />;

  return (
    <div className={`tabstrip ${focused ? 'focused' : ''}`} data-strip-leaf={leaf.id}>
      <div
        className="tablist"
        role="tablist"
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
          const { view, session } = viewOf(tab);
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
                title={[view?.primary, where, view?.fullPath, view?.status.label]
                  .filter(Boolean)
                  .join('\n')}
                onPointerDown={(e) => {
                  // 中クリックはブラウザのオートスクロールが始まってしまう
                  if (e.button === 1) e.preventDefault();
                  if ((e.target as HTMLElement).closest('.tab-close')) return;
                  onActivate(tab.id);
                  armDrag(e, {
                    kind: 'window',
                    sessionId: tab.sessionId,
                    windowId: tab.windowId,
                    label,
                    fromTabId: tab.id,
                  });
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
                  if (e.key === 'ArrowLeft') step(i, -1);
                  else if (e.key === 'ArrowRight') step(i, 1);
                  else if (e.key === 'Delete' || e.key === 'Backspace') onClose(tab.id);
                  else return;
                  e.preventDefault();
                }}
              >
                <span className={`state-dot ${kind}`} />
                <span className="tab-name">{label}</span>
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
                  ✕
                </button>
              </div>
            </div>
          );
        })}
        {caret === null && mark}
      </div>

      <div className="strip-tools">
        <button
          className="strip-btn"
          title="新しい端末をタブで開く (Alt+T)"
          aria-label="新しい端末をタブで開く"
          onClick={onNewTab}
        >
          ＋
        </button>
        {closableTile && (
          <button
            className="strip-btn danger"
            title="このタイルを閉じる（中のタブも全部閉じます）"
            aria-label="このタイルを閉じる"
            onClick={onCloseTile}
          >
            ⨯
          </button>
        )}
      </div>
    </div>
  );
}
