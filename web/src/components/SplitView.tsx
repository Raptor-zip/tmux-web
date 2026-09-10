import { useCallback, useMemo, useRef, useState } from 'react';
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
  tree: LayoutNode;
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
  onNewTab(leafId: string): void;
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
  tree,
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

  const tiles = useMemo(() => leafRects(tree), [tree]);
  const bars = useMemo(() => dividers(tree), [tree]);
  const closableTile = tiles.length > 1;

  /** タブが映しているウィンドウ。windowId が null のタブはセッションのアクティブを見る */
  const viewOf = useCallback(
    (tab: TabRef) => {
      const session = sessions.find((s) => s.id === tab.sessionId) ?? null;
      const win = tab.windowId
        ? windows.find((w) => w.id === tab.windowId)
        : windows.find((w) => w.sessionId === tab.sessionId && w.active);
      return { view: win ? views.get(win.id) ?? null : null, session };
    },
    [sessions, windows, views],
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
    [tiles],
  );

  const startDividerDrag = useCallback(
    (e: React.PointerEvent, split: { id: string; dir: 'row' | 'column'; parent: Rect }) => {
      e.preventDefault();
      const host = hostRef.current;
      if (!host) return;
      const box = host.getBoundingClientRect();
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
        (e.target as HTMLElement).releasePointerCapture?.(ev.pointerId);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [onRatio],
  );

  return (
    <div className="splitview" ref={hostRef}>
      {tiles.map(({ leaf, rect }) => {
        const tab = activeTab(leaf);
        const { view } = tab ? viewOf(tab) : { view: null };
        const focused = leaf.id === focusedId;
        const tabDrop = dropAt?.kind === 'tab' && dropAt.leafId === leaf.id;

        return (
          <div
            key={leaf.id}
            className={`tile ${focused ? 'focused' : ''} ${tabDrop ? 'drop-tab' : ''}`}
            style={pct(rect)}
            onMouseDown={() => onFocus(leaf.id)}
          >
            <TabStrip
              leaf={leaf}
              focused={focused}
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
              onNewTab={() => onNewTab(leaf.id)}
              onStartDrag={onStartDrag}
              onContextMenu={onTabContextMenu}
            />

            <div className="tile-body">
              {tab ? (
                <TerminalView
                  ref={(h) => registerTerm(leaf.id, h)}
                  sessionId={pendingRemap ? null : tab.sessionId}
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
            </div>
          </div>
        );
      })}

      {bars.map((d) => (
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
  );
}
