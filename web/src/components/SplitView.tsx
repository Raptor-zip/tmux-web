import { useCallback, useMemo, useRef, useState } from 'react';
import {
  dividers,
  dropSideFor,
  leafRects,
  type DropSide,
  type LayoutNode,
  type Rect,
} from '../layout';
import { TerminalView, type TerminalHandle } from './Terminal';
import type { Pane, Session, TmuxWindow } from '../types';

/** サイドバーからドラッグしてくるウィンドウ、またはセッションそのもの */
export interface DragPayload {
  /** session を掴んだときは windowId が null になり、代表ウィンドウが開かれる */
  kind: 'window' | 'session';
  sessionId: string;
  windowId: string | null;
  label: string;
}

interface Props {
  tree: LayoutNode;
  focusedId: string | null;
  sessions: Session[];
  windows: TmuxWindow[];
  panes: Pane[];
  mode: 'mirror' | 'direct';
  showStatusBar: boolean;
  fontSize: number;
  /** ドラッグ中のウィンドウ。null ならドラッグしていない */
  drag: DragPayload | null;
  onFocus(leafId: string): void;
  onClose(leafId: string): void;
  onDropWindow(targetLeafId: string, side: DropSide, payload: DragPayload): void;
  onDragEnd(): void;
  onRatio(splitId: string, ratio: number): void;
  onStatus(leafId: string, status: { connected: boolean; message?: string }): void;
  registerTerm(leafId: string, handle: TerminalHandle | null): void;
}

const pct = (r: Rect) => ({
  left: `${r.left}%`,
  top: `${r.top}%`,
  width: `${r.width}%`,
  height: `${r.height}%`,
});

/** ドロップ先のプレビュー矩形（タイルのどこに入るかを見せる） */
function previewRect(rect: Rect, side: DropSide): Rect {
  switch (side) {
    case 'left':
      return { ...rect, width: rect.width / 2 };
    case 'right':
      return { ...rect, left: rect.left + rect.width / 2, width: rect.width / 2 };
    case 'top':
      return { ...rect, height: rect.height / 2 };
    case 'bottom':
      return { ...rect, top: rect.top + rect.height / 2, height: rect.height / 2 };
    default:
      return rect;
  }
}

export function SplitView({
  tree,
  focusedId,
  sessions,
  windows,
  panes,
  mode,
  showStatusBar,
  fontSize,
  drag,
  onFocus,
  onClose,
  onDropWindow,
  onDragEnd,
  onRatio,
  onStatus,
  registerTerm,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [dropHint, setDropHint] = useState<{ leafId: string; side: DropSide } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);

  const tiles = useMemo(() => leafRects(tree), [tree]);
  const bars = useMemo(() => dividers(tree), [tree]);
  const closable = tiles.length > 1;

  /** カーソル位置から「どのタイルのどの辺か」を求める。矩形は % なので実寸に直して判定する */
  const hitTest = useCallback(
    (clientX: number, clientY: number) => {
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
      return {
        leafId: hit.leaf.id,
        side: dropSideFor(
          x - hit.rect.left,
          y - hit.rect.top,
          hit.rect.width,
          hit.rect.height,
        ),
      };
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
        const session = sessions.find((s) => s.id === leaf.sessionId) ?? null;
        const win = windows.find((w) => w.id === leaf.windowId) ?? null;
        const lead =
          panes.find((p) => p.windowId === leaf.windowId && p.active) ??
          panes.find((p) => p.windowId === leaf.windowId) ??
          null;
        const focused = leaf.id === focusedId;

        return (
          <div
            key={leaf.id}
            className={`tile ${focused ? 'focused' : ''}`}
            style={pct(rect)}
            onMouseDown={() => onFocus(leaf.id)}
          >
            <div className="tile-head">
              <span className="tile-title" title={`${session?.name ?? ''} / ${win?.name ?? ''}`}>
                <span className="tile-session">{session?.name ?? '—'}</span>
                <span className="tile-sep">/</span>
                <span className="tile-window">
                  {win ? `${win.index}:${win.name}` : 'ウィンドウなし'}
                </span>
              </span>
              <span className="tile-sub">{lead?.title || lead?.command || ''}</span>
              {closable && (
                <button
                  className="tile-close"
                  title="このタイルを閉じる"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(leaf.id);
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            <div className="tile-body">
              <TerminalView
                ref={(h) => registerTerm(leaf.id, h)}
                sessionId={leaf.sessionId}
                windowId={leaf.windowId}
                windowIndex={win?.index ?? null}
                mode={mode}
                showStatusBar={showStatusBar}
                fontSize={fontSize}
                onStatus={(s) => onStatus(leaf.id, s)}
              />
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
            setDropHint(hitTest(e.clientX, e.clientY));
          }}
          onPointerUp={(e) => {
            const target = hitTest(e.clientX, e.clientY);
            setDropHint(null);
            setGhost(null);
            if (target) onDropWindow(target.leafId, target.side, drag);
            onDragEnd();
          }}
          onPointerCancel={() => {
            setDropHint(null);
            setGhost(null);
            onDragEnd();
          }}
        />
      )}

      {drag && dropHint && (
        <div
          className="drop-preview"
          style={pct(
            previewRect(
              tiles.find((t) => t.leaf.id === dropHint.leafId)?.rect ?? {
                left: 0,
                top: 0,
                width: 100,
                height: 100,
              },
              dropHint.side,
            ),
          )}
        >
          <span>{dropHint.side === 'center' ? 'ここに差し替え' : 'ここに並べる'}</span>
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
