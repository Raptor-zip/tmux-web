import { Icon } from './Icon';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TmuxWindow } from '../types';
import type { WindowView } from '../windows';

export interface SwitchItem {
  view: WindowView;
  /** すでにタブで開いているか */
  open: boolean;
  /** そのウィンドウがあるセッション名 */
  session: string;
  deviceName: string;
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
  const [selectedId, setSelectedId] = useState<string | null>(() => items[0]?.view.win.id ?? null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Focus the close control on touch devices so merely opening the list does not
    // summon the software keyboard. Desktop users can type immediately.
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (dismissRef.current) dismissRef.current.autofocus = touch;
    if (inputRef.current) inputRef.current.autofocus = !touch;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus({ preventScroll: true }); };
  }, []);

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
        it.deviceName,
        it.view.status.label,
        ...it.view.status.chips,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [items, query]);

  // Live status updates can reorder the results. Keep the chosen window by ID;
  // if it disappears, fall back to a result that still exists.
  const selected = Math.max(0, rows.findIndex(row => row.view.win.id === selectedId));
  useEffect(() => {
    if (rows.some(row => row.view.win.id === selectedId)) return;
    const first = rows[0]?.view.win.id ?? null;
    if (first !== selectedId) setSelectedId(first);
  }, [rows, selectedId]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.sw-row.on')?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, query]);

  const move = (d: number) => {
    if (rows.length === 0) return;
    setSelectedId(rows[(selected + d + rows.length) % rows.length].view.win.id);
  };

  const pick = (i: number) => {
    const row = rows[i];
    if (!row) return;
    onClose();
    onPick(row.view.win);
  };

  return (
    <dialog ref={dialogRef} tabIndex={-1} className="switcher" aria-label="ウィンドウを切り替える"
      onKeyDown={e => e.stopPropagation()} onCancel={e => { e.preventDefault(); onClose(); }}
      onClick={e => {
        if (e.target !== e.currentTarget) return;
        const box = e.currentTarget.getBoundingClientRect();
        if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose();
      }}>
      <div className="sw-header">
        <input
          className="sw-input"
          ref={inputRef}
          role="combobox"
          aria-label="ウィンドウを検索"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={rows.length ? `${listId}-${selected}` : undefined}
          autoComplete="off"
          value={query}
          placeholder="作業名・パス・デバイスで検索"
          onChange={(e) => { setQuery(e.target.value); setSelectedId(null); }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'ArrowDown') move(1);
            else if (e.key === 'ArrowUp') move(-1);
            else if (e.key === 'Enter') pick(selected);
            else return;
            e.preventDefault();
          }}
        />
        <button ref={dismissRef} className="icon-btn sw-dismiss" aria-label="ウィンドウ一覧を閉じる" onClick={onClose}><Icon name="close" /></button>
      </div>

      <div className="sw-list" ref={listRef} id={listId} role="listbox" aria-label="ウィンドウ">
        {rows.length === 0 && <p className="sw-empty">一致するウィンドウはありません。</p>}
        {rows.map((it, i) => {
          const v = it.view;
          return (
            <div
              key={v.win.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === selected}
              className={`sw-row st-${v.status.kind} ${i === selected ? 'on' : ''}`}
              onMouseMove={() => setSelectedId(v.win.id)}
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
                    {[it.deviceName, it.session, v.where, v.rel].filter(Boolean).join(' · ')}
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
    </dialog>
  );
}
