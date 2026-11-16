import { Icon } from './Icon';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TmuxWindow } from '../types';
import type { WindowView } from '../windows';
import { matchesCommand, type PaletteCommand } from '../commands';

export interface SwitchItem {
  view: WindowView;
  /** すでにタブで開いているか */
  open: boolean;
  /** そのウィンドウがあるセッション名 */
  session: string;
  deviceName: string;
}

/** 『タブ』スコープの 1 パネル。パネルは番号ではなく表示中のタブ名で示す */
export interface PaletteTabGroup {
  leafId: string;
  /** 表示中のタブ名 */
  name: string;
  /** 入力先のパネルか */
  focused: boolean;
  tabs: PaletteTab[];
}

export interface PaletteTab {
  id: string;
  title: string;
  /** 2 行目（作業名など） */
  task: string;
  device: string;
  /** そのパネルで表示中のタブか */
  active: boolean;
  /** 検索に使う語 */
  search: string;
  /** 状態（入力待ち・実行中など）。スマホのタブ一覧で状態の形に使う */
  kind?: string;
  /** リモートデスクトップのタブ */
  screen?: boolean;
  /** ローカル以外のデバイス（タブ一覧ではデバイス名を添える） */
  remote?: boolean;
}

export type PaletteScope = 'terminal' | 'tab' | 'command';

const SCOPES: { id: PaletteScope; label: string }[] = [
  { id: 'terminal', label: '端末' },
  { id: 'tab', label: 'タブ' },
  { id: 'command', label: '操作' },
];

interface Props {
  items: SwitchItem[];
  tabGroups: PaletteTabGroup[];
  commands: PaletteCommand[];
  /** sudo の承認待ち（無ければ null） */
  approval: { cmd: string } | null;
  initialScope?: PaletteScope;
  /** 『端末』を入力待ち・承認待ちだけに絞って開く（上バーの『入力待ち N』から） */
  waitingOnly?: boolean;
  onPick(win: TmuxWindow): void;
  onPickTab(leafId: string, tabId: string): void;
  onApproval(): void;
  onShortcuts(): void;
  onClose(): void;
}

/** 一覧の 1 行。section が変わるところに見出しを出す */
interface Row {
  key: string;
  section: string;
  className?: string;
  disabled?: boolean;
  run(): void;
  render(selected: boolean): ReactNode;
}

const windowText = (it: SwitchItem) =>
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
    .toLowerCase();

/**
 * パレット（探す・操作）。Alt+P で『端末』、Alt+Shift+P で『操作』を開く。
 *
 * 端末：直前に見ていた順に並べ、打ちながら絞り込む。入力待ち・承認待ちは一番上に出す。
 * タブ：このワークスペースのタブをパネル別に出す（旧『タブ・パネルの一覧』）。
 * 操作：commands.ts の登録表を名前と別名で探して実行する。先頭に > を打っても『操作』になる。
 */
export function Switcher({ items, tabGroups, commands, approval, initialScope = 'terminal', waitingOnly = false, onPick, onPickTab, onApproval, onShortcuts, onClose }: Props) {
  const [scope, setScope] = useState<PaletteScope>(initialScope);
  const [onlyWaiting, setOnlyWaiting] = useState(waitingOnly);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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

  const finish = (run: () => void) => { onClose(); run(); };

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    if (scope === 'terminal') {
      const matched = q ? items.filter(it => windowText(it).includes(q)) : items;
      const out: Row[] = [];
      if (approval && (!q || ['承認待ち', 'sudo', approval.cmd].join(' ').toLowerCase().includes(q))) {
        out.push({
          key: 'approval',
          section: '入力待ち・承認',
          run: onApproval,
          render: () => (
            <>
              <Icon name="lock" />
              <span className="sw-text">
                <span className="sw-main"><span className="sw-project">承認待ち</span><span className="sw-title">{approval.cmd}</span></span>
                <span className="sw-sub">sudo · Enter で内容を確認</span>
              </span>
            </>
          ),
        });
      }
      const windowRow = (it: SwitchItem, section: string): Row => {
        const v = it.view;
        return {
          key: v.win.id,
          section,
          className: `st-${v.status.kind}`,
          run: () => onPick(v.win),
          render: () => (
            <>
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
            </>
          ),
        };
      };
      for (const it of matched) if (it.view.status.kind === 'waiting') out.push(windowRow(it, '入力待ち・承認'));
      if (!onlyWaiting) for (const it of matched) if (it.view.status.kind !== 'waiting') out.push(windowRow(it, '端末'));
      return out;
    }
    if (scope === 'tab') {
      return tabGroups.flatMap(group => {
        const heading = `パネル「${group.name}」${group.focused ? ' · 入力先' : ''}`;
        return group.tabs
          .filter(tab => !q || tab.search.toLowerCase().includes(q))
          .map<Row>(tab => ({
            key: tab.id,
            section: heading,
            run: () => onPickTab(group.leafId, tab.id),
            render: () => (
              <>
                <span className="sw-text">
                  <span className="sw-main">
                    <span className="sw-project">{tab.title}</span>
                    <span className="sw-title">{tab.task}</span>
                  </span>
                  <span className="sw-sub">{tab.device}</span>
                </span>
                {tab.active && group.focused ? <span className="badge open">選択中</span> : tab.active && <span className="badge">表示中</span>}
              </>
            ),
          }));
      });
    }
    return commands
      .filter(c => matchesCommand(c, q))
      .map<Row>(c => ({
        key: c.key,
        section: '操作',
        disabled: !!c.disabledReason,
        run: c.run,
        render: () => (
          <>
            <span className="sw-text">
              <span className={`sw-command ${c.danger ? 'danger' : ''}`}>{c.label}</span>
              {c.disabledReason && <span className="sw-sub">{c.disabledReason}</span>}
            </span>
            {c.hint && <span className="sw-hint">{c.hint}</span>}
          </>
        ),
      }));
  }, [scope, query, onlyWaiting, items, tabGroups, commands, approval, onPick, onPickTab, onApproval]);

  // Live status updates can reorder the results. Keep the chosen row by key;
  // if it disappears, fall back to a result that still exists.
  const found = rows.findIndex(row => row.key === selectedKey);
  const selected = Math.max(0, found);
  useEffect(() => {
    if (found >= 0) return;
    const first = rows[0]?.key ?? null;
    if (first !== selectedKey) setSelectedKey(first);
  }, [rows, found, selectedKey]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.sw-row.on')?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey, query, scope]);

  const move = (d: number) => {
    if (rows.length === 0) return;
    setSelectedKey(rows[(selected + d + rows.length) % rows.length].key);
  };

  const pick = (i: number) => {
    const row = rows[i];
    if (!row || row.disabled) return;
    finish(row.run);
  };

  const changeScope = (next: PaletteScope) => {
    setScope(next);
    setSelectedKey(null);
  };

  const placeholder = scope === 'terminal'
    ? '端末・操作を探す…（> で操作）'
    : scope === 'tab' ? 'タブを探す（プロジェクト・デバイス・作業名）' : '操作を探す…';
  const empty = scope === 'terminal' ? (onlyWaiting ? '入力待ちの端末はありません。' : '一致する端末はありません。') : scope === 'tab' ? '一致するタブはありません。' : '一致する操作はありません。';

  let lastSection = '';
  return (
    <dialog ref={dialogRef} tabIndex={-1} className="switcher" aria-label="探す・操作"
      onKeyDown={e => {
        e.stopPropagation();
        // パレットの中でも Alt+P / Alt+Shift+P でスコープを切り替えられる
        if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyP') {
          e.preventDefault();
          changeScope(e.shiftKey ? 'command' : 'terminal');
          inputRef.current?.focus();
        }
      }}
      onCancel={e => { e.preventDefault(); onClose(); }}
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
          aria-label="探す・操作"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={rows.length ? `${listId}-${selected}` : undefined}
          autoComplete="off"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            const value = e.target.value;
            // 先頭の > は『操作』への切り替え（VS Code のコマンドパレットと同じ）
            if (value.startsWith('>')) {
              changeScope('command');
              setQuery(value.slice(1).trimStart());
              return;
            }
            setQuery(value);
            setSelectedKey(null);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            // 修飾キー付き（Alt+Enter など）は選択に使わない
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            if (e.key === 'ArrowDown') move(1);
            else if (e.key === 'ArrowUp') move(-1);
            else if (e.key === 'Enter') pick(selected);
            else if (e.key === 'Backspace' && !query && scope === 'command' && initialScope !== 'command') changeScope('terminal');
            else return;
            e.preventDefault();
          }}
        />
        <button ref={dismissRef} className="icon-btn sw-dismiss" aria-label="探す・操作を閉じる" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="sw-scopes" role="group" aria-label="探す対象">
        {SCOPES.map(s => (
          <button key={s.id} type="button" className="sw-scope" aria-pressed={scope === s.id}
            onClick={() => { changeScope(s.id); inputRef.current?.focus({ preventScroll: true }); }}>
            {s.label}
          </button>
        ))}
        {scope === 'terminal' && <button type="button" className="sw-scope sw-filter" aria-pressed={onlyWaiting}
          onClick={() => { setOnlyWaiting(v => !v); setSelectedKey(null); inputRef.current?.focus({ preventScroll: true }); }}>
          入力待ちだけ
        </button>}
      </div>

      <div className="sw-list" ref={listRef} id={listId} role="listbox" aria-label={SCOPES.find(s => s.id === scope)!.label}>
        {rows.length === 0 && <p className="sw-empty">{empty}</p>}
        {rows.map((row, i) => {
          const heading = row.section !== lastSection ? row.section : null;
          lastSection = row.section;
          return (
            <div key={row.key} role="presentation">
              {heading && <div className="sw-section" role="presentation">{heading}</div>}
              <div
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === selected}
                aria-disabled={row.disabled || undefined}
                data-key={row.key}
                className={`sw-row ${row.className ?? ''} ${scope === 'tab' ? 'sw-tab' : scope === 'command' ? 'sw-cmd' : ''} ${i === selected ? 'on' : ''} ${row.disabled ? 'disabled' : ''}`}
                onMouseMove={() => { if (row.key !== selectedKey) setSelectedKey(row.key); }}
                onClick={() => pick(i)}
              >
                {row.render(i === selected)}
              </div>
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
          <kbd>Enter</kbd> {scope === 'command' ? '実行' : '開く'}
        </span>
        <span>
          <kbd>Esc</kbd> 閉じる
        </span>
        <button type="button" className="sw-foot-link" onClick={() => finish(onShortcuts)}>
          <kbd>Alt+/</kbd> ショートカット一覧
        </button>
      </div>
    </dialog>
  );
}
