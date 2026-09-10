import { useEffect, useMemo, useRef, useState } from 'react';
import type { TmuxWindow } from '../types';
import type { WindowView } from '../windows';

export interface SwitchItem {
  view: WindowView;
  /** すでにタブで開いているか */
  open: boolean;
  /** そのウィンドウがあるセッション名 */
  session: string;
}

interface Props {
  items: SwitchItem[];
  onPick(win: TmuxWindow): void;
  onClose(): void;
}

/**
 * ウィンドウの切り替えパレット（Alt+P）。
 *
 * タブが増えてくると、目当ての端末を探すのに一覧を上下に追うことになる。
 * Windows のウィンドウ切り替えと同じで、直前に見ていた順に並べて、
 * 打ちながら絞り込めるようにする。すでに開いているものは前面に出すだけ。
 */
export function Switcher({ items, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      [
        it.view.project,
        it.view.primary,
        it.view.where,
        it.view.fullPath,
        it.view.command,
        it.session,
        it.view.status.label,
        ...it.view.status.chips,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [items, query]);

  // 絞り込むたびに先頭へ戻す。前の位置に残ると、見えていない行が選ばれたままになる
  useEffect(() => setAt(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.sw-row.on')?.scrollIntoView({ block: 'nearest' });
  }, [at, rows]);

  const move = (d: number) => {
    if (rows.length === 0) return;
    setAt((i) => (i + d + rows.length) % rows.length);
  };

  const pick = (i: number) => {
    const row = rows[i];
    if (!row) return;
    onClose();
    onPick(row.view.win);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="switcher" role="dialog" aria-modal="true" aria-label="ウィンドウを切り替える">
        <input
          className="sw-input"
          autoFocus
          value={query}
          placeholder="ウィンドウを切り替える… プロジェクト名・作業内容・パスで絞り込む"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) move(1);
            else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) move(-1);
            else if (e.key === 'Enter') pick(at);
            else if (e.key === 'Escape') onClose();
            else return;
            e.preventDefault();
          }}
        />

        <div className="sw-list" ref={listRef}>
          {rows.length === 0 && <p className="sw-empty">一致するウィンドウはありません。</p>}
          {rows.map((it, i) => {
            const v = it.view;
            return (
              <div
                key={v.win.id}
                className={`sw-row st-${v.status.kind} ${i === at ? 'on' : ''}`}
                onMouseMove={() => setAt(i)}
                onClick={() => pick(i)}
              >
                <span className={`state-dot ${v.status.kind}`} />
                <span className="sw-text">
                  <span className="sw-main">
                    <span className="sw-project">{v.project}</span>
                    <span className="sw-title">{v.primary}</span>
                  </span>
                  <span className="sw-sub">
                    <span className={`state-text ${v.status.kind}`}>{v.status.label}</span>
                    <span className="sub-rest">
                      {' · '}
                      {[it.session, v.where, v.rel].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </span>
                {it.open && <span className="badge open">表示中</span>}
              </div>
            );
          })}
        </div>

        <div className="sw-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 選ぶ
          </span>
          <span>
            <kbd>Enter</kbd> 開く
          </span>
          <span>
            <kbd>Esc</kbd> 閉じる
          </span>
        </div>
      </div>
    </div>
  );
}
