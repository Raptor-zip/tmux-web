import { useLongPress } from '../hooks/useLongPress';
import type { Device } from '../devices';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { tabPayload, type DragPayload } from './SplitView';
import { isScreenTab, type LeafNode, type TabRef } from '../layout';
import type { Session } from '../types';
import { distinguishTitles, whereWithSession, type WindowView } from '../windows';

interface Props {
  leaf: LeafNode;
  focused: boolean;
  /** 1画面表示では、同じワークスペースの全パネルからタブを並べる。 */
  desktopTabs?: { tab: TabRef; leafId: string }[];
  /** タブ id → 表示に使う情報。tmux 側に無いタブは undefined になる */
  viewOf(tab: TabRef): { view: WindowView | null; session: Session | null; device?: Device };
  /** ドラッグ中のタブ id（掴んでいる本人を薄くする） */
  draggingTabId: string | null;
  /**
   * 差し込み位置の目印。undefined = このタイルは落とし先ではない、
   * null = 末尾、文字列 = そのタブの手前
   */
  caret?: string | null;
  /**
   * 1 枚だけを大きく出しているときの見出しのチップ。
   * focus = 最大化中（押すと並びに戻す）、auto = 狭くて自動の 1 パネル表示（押すとパレットの『タブ』）。
   */
  single?: { kind: 'focus' | 'auto'; others: number };
  onRestore(): void;
  onOverview(): void;
  onActivate(tabId: string): void;
  onClose(tabId: string): void;
  /** ＋ の本体：新しい端末（Alt+T と同じ） */
  onNewTab(): void;
  /** ＋ の ▾（タッチでは ＋ の長押しでも）：新規メニュー */
  onNewMenu(x: number, y: number): void;
  onStartDrag(payload: DragPayload): void;
  /** タブメニューを開く（タブの右クリック・長押し・Shift+F10、見出しの ⋯） */
  onContextMenu(tabId: string, x: number, y: number): void;
  /** 画面タブの見出しの部品（状態・見るだけ・⌨・Esc）を差し込む口。RemoteScreen が createPortal で描く */
  slotRef?(el: HTMLElement | null): void;
}

/**
 * タイルの上に並ぶタブ。1 タブ = tmux のウィンドウ 1 つか、デバイスのリモートデスクトップ 1 つ。
 *
 * ブラウザのタブと同じ操作にしてある（クリックで切り替え・中クリックで閉じる・
 * 掴んで並べ替え／別のタイルへ移動・空きをダブルクリックで新しい端末）。
 */
export function TabStrip({
  leaf,
  focused,
  desktopTabs,
  viewOf,
  draggingTabId,
  caret,
  single,
  onRestore,
  onOverview,
  onActivate,
  onClose,
  onNewTab,
  onNewMenu,
  onStartDrag,
  onContextMenu,
  slotRef,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const tabs = desktopTabs ?? leaf.tabs.map(tab => ({ tab, leafId: leaf.id }));
  /** タッチでタブを長押ししたらタブメニュー。マウスは右クリックがある */
  const longPress = useLongPress<string>((tabId, point) => onContextMenu(tabId, point.x, point.y));
  /** タッチで ＋ を長押ししたら新規メニュー（▾ と同じ） */
  const plusPress = useLongPress<null>((_, point) => onNewMenu(point.x, point.y));

  /** タブごとの表示名と、同じ名前が並んだときの区別用の表記 */
  const shown = tabs.map(({ tab, leafId }) => {
    const { view, session, device } = viewOf(tab);
    const screen = isScreenTab(tab);
    const label = screen ? device?.name ?? 'リモートデスクトップ' : view?.project || tab.sessionName || '—';
    return { tab, leafId, view, session, device, screen, label };
  });
  const marks = distinguishTitles(shown.map(t => ({
    key: t.tab.id,
    title: t.label,
    hints: t.screen ? [] : [t.view?.where, t.session?.name, t.device?.name],
  })));
  const markKey = [...marks].join('|');
  const stableMarks = useMemo(() => marks, [markKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** あふれたタブ列：端をフェードさせ、‹ › で送る */
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const left = list.scrollLeft > 1;
    const right = list.scrollLeft + list.clientWidth < list.scrollWidth - 1;
    setOverflow(prev => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [measure, tabs.length, stableMarks]);
  const scrollBy = (dir: -1 | 1) => {
    const list = listRef.current;
    if (!list) return;
    list.scrollBy({ left: dir * Math.max(80, list.clientWidth * 0.7), behavior: 'smooth' });
  };

  // 前面のタブが隠れていたら見える位置まで送る（キーボードで切り替えたときに要る）
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const reveal = () => {
      const el = list.querySelector<HTMLElement>('.tab.active');
      if (!el) return;
      const box = list.getBoundingClientRect();
      const tabBox = el.getBoundingClientRect();
      // An oversized tab cannot fit both edges. Keep its name visible first;
      // the user can still swipe horizontally to its trailing controls.
      if (tabBox.width > box.width || tabBox.left < box.left) list.scrollLeft += tabBox.left - box.left;
      else if (tabBox.right > box.right) list.scrollLeft += tabBox.right - box.right;
    };
    reveal();
    measure();
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    return () => observer.disconnect();
  }, [leaf.activeId, tabs.length, measure]);

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
    const next = tabs[from + delta]?.tab;
    if (next) {
      onActivate(next.id);
      requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[from + delta]?.focus());
    }
  };

  const mark = caret === undefined ? undefined : <span key="caret" className="tab-caret" />;

  return (
    <div className={`tabstrip ${focused ? 'focused' : ''}`} data-strip-leaf={leaf.id}>
      {single?.kind === 'focus' && (
        <button className="strip-chip" title="最大化中 · 並びに戻す (Alt+Enter)" onClick={onRestore}>
          <Icon name="shrink" />最大化中 · 並びに戻す
        </button>
      )}
      {single?.kind === 'auto' && single.others > 0 && (
        <button className="strip-chip" title="ほかのパネルとタブの一覧を開く" onClick={onOverview}>
          他 {single.others} パネル
        </button>
      )}
      {(overflow.left || overflow.right) && (
        <button className="strip-btn strip-scroll" aria-label="タブ列を左へ送る" title="タブ列を左へ送る" tabIndex={-1}
          disabled={!overflow.left} onClick={() => scrollBy(-1)}><Icon name="chevron-left" /></button>
      )}
      <div
        className={`tablist ${overflow.left ? 'fade-left' : ''} ${overflow.right ? 'fade-right' : ''}`}
        onScroll={measure}
        role="tablist"
        aria-label={desktopTabs ? "このワークスペースのタブ" : "このパネルのタブ"}
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
        {shown.map(({ tab, leafId, view, session, device, screen, label }, i) => {
          const active = tab.id === leaf.activeId;
          const kind = view?.status.kind ?? 'idle';
          const titleMark = stableMarks.get(tab.id);
          // 1 画面表示でパネルをまたぐところに細い区切りを入れる
          const boundary = i > 0 && desktopTabs && shown[i - 1].leafId !== leafId;
          const where = screen ? 'リモートデスクトップ' : view ? whereWithSession(view, session) : '接続が切れました';
          const hold = longPress.bind(tab.id);
          return (
            <Fragment key={tab.id}>
            {boundary && <span className="tab-panel-sep" aria-hidden="true" />}
            <div className="tab-slot" data-strip-leaf={leafId}>
              {caret === tab.id && mark}
              <div
                className={`tab st-${kind} ${screen ? 'tab-screen' : ''} ${active ? 'active' : ''} ${
                  draggingTabId === tab.id ? 'dragging' : ''
                }`}
                data-tab-id={tab.id}
                data-leaf-id={leafId}
                role="tab"
                tabIndex={active ? 0 : -1}
                aria-selected={active}
                title={(screen ? [device?.name, where, device && !device.connected ? '未接続' : ''] : [device?.name, view?.primary, where, view?.fullPath, view?.status.label])
                  .filter(Boolean)
                  .join('\n')}
                onPointerDown={(e) => {
                  // 中クリックはブラウザのオートスクロールが始まってしまう
                  if (e.button === 1) e.preventDefault();
                  if ((e.target as HTMLElement).closest('button')) return;
                  hold.onPointerDown?.(e);
                  if (e.pointerType === 'mouse' && e.button === 0) onActivate(tab.id);
                  armDrag(e, tabPayload(tab, label));
                }}
                onPointerMove={hold.onPointerMove}
                onPointerUp={hold.onPointerUp}
                onPointerCancel={hold.onPointerCancel}
                onPointerLeave={hold.onPointerLeave}
                onClickCapture={hold.onClickCapture}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest('button')) onActivate(tab.id);
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onClose(tab.id);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  // Android は長押しでも contextmenu を出す。長押しの方は取り消して、二重に開かない
                  longPress.cancel();
                  const r = e.currentTarget.getBoundingClientRect();
                  onContextMenu(tab.id, e.clientX || r.left, e.clientY || r.bottom);
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
                    // 既定動作の contextmenu で、もう一度（位置を変えて）開かないよう止める
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    onContextMenu(tab.id, r.left, r.bottom);
                  } else if (e.key === 'Enter' || e.key === ' ') onActivate(tab.id);
                  else if (e.key === 'ArrowLeft') step(i, -1);
                  else if (e.key === 'ArrowRight') step(i, 1);
                  else if (e.key === 'Home') step(i, -i);
                  else if (e.key === 'End') step(i, tabs.length - 1 - i);
                  else if (e.key === 'Delete' || e.key === 'Backspace') onClose(tab.id);
                  else return;
                  e.preventDefault();
                }}
              >
                {screen ? <span className="tab-kind" aria-hidden="true"><Icon name="screen" /></span> : <span className={`state-dot ${kind}`} />}
                <span className="tab-name">{label}</span>
                {titleMark && <span className="tab-mark">· {titleMark}</span>}
                {screen && device && !device.connected && <span className="tab-device" title={device.error}>切断</span>}
                {!screen && device && !device.local && <span className="tab-device" title={device.error}>{device.connected ? device.name : `${device.name} · 切断`}</span>}
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
            </Fragment>
          );
        })}
        {caret === null && mark}
      </div>

      {(overflow.left || overflow.right) && (
        <button className="strip-btn strip-scroll" aria-label="タブ列を右へ送る" title="タブ列を右へ送る" tabIndex={-1}
          disabled={!overflow.right} onClick={() => scrollBy(1)}><Icon name="chevron-right" /></button>
      )}

      <span className="strip-screen" ref={slotRef} />

      <div className="strip-tools">
        <div className="split-new" role="group" aria-label="新しく開く">
          <button className="strip-btn new-main" title="新しい端末 (Alt+T)" aria-label="新しい端末"
            {...plusPress.bind(null)}
            onContextMenu={e => e.preventDefault()}
            onClick={() => onNewTab()}><Icon name="plus" /></button>
          <button className="strip-btn new-more" title="新規メニュー (Alt+Shift+T)" aria-label="新規メニュー" aria-haspopup="menu"
            onClick={e => { const r = e.currentTarget.getBoundingClientRect(); onNewMenu(r.left, r.bottom); }}><Icon name="chevron-down" /></button>
        </div>
        <button className="strip-btn" title="タブの操作" aria-label="タブの操作" aria-haspopup="menu"
          onClick={e => { const r = e.currentTarget.getBoundingClientRect(); onContextMenu(leaf.activeId, r.right, r.bottom); }}><Icon name="more" /></button>
      </div>
    </div>
  );
}
