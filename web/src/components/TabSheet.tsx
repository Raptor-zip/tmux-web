import { useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { useLongPress } from '../hooks/useLongPress';
import type { PaletteTabGroup } from './Switcher';

interface Props {
  groups: PaletteTabGroup[];
  workspaces: { id: string; name: string }[];
  activeWorkspace: string;
  /** 接続状態の要約（接続済み / 切断 など） */
  connection: string;
  connectionBad: boolean;
  onSearch(): void;
  onConnection(): void;
  onSelectWorkspace(id: string): void;
  onNewWorkspace(): void;
  /** ワークスペースの右クリック・長押し：名前を変更… / 削除… などのメニュー */
  onWorkspaceMenu(id: string, x: number, y: number): void;
  onPickTab(leafId: string, tabId: string): void;
  /** 行末の ⋯：そのタブのタブメニュー */
  onTabMenu(tabId: string, x: number, y: number): void;
  onClose(): void;
}

/**
 * スマホのタブ一覧シート（見出しの『現在のタブ ▾ n/m』から開く）。
 * 先頭に ⌕ と接続状態、ワークスペースの列、そしてパネル別のタブ。パネルは表示中のタブ名で示す。
 */
export function TabSheet({ groups, workspaces, activeWorkspace, connection, connectionBad, onSearch, onConnection, onSelectWorkspace, onNewWorkspace, onWorkspaceMenu, onPickTab, onTabMenu, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const press = useLongPress<string>((id, { x, y }) => onWorkspaceMenu(id, x, y));
  useEffect(() => {
    const node = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    node?.showModal();
    // 指で開いたときにソフトキーボードを出さないよう、入力欄ではなく選択中のタブに置く
    node?.querySelector<HTMLElement>('.tsheet-tab[aria-current="true"]')?.focus({ preventScroll: true });
    return () => { node?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className="tab-sheet" aria-label="タブ一覧"
    onKeyDown={e => e.stopPropagation()}
    onCancel={e => { e.preventDefault(); onClose(); }}
    onClick={e => {
      if (e.target !== e.currentTarget) return;
      const box = e.currentTarget.getBoundingClientRect();
      if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose();
    }}>
    <header className="tsheet-head">
      <h2>タブ一覧</h2>
      <button className="icon-btn" aria-label="タブ一覧を閉じる" onClick={onClose}><Icon name="close" /></button>
    </header>
    <div className="tsheet-body">
      <div className="tsheet-top">
        <button className="tsheet-search" onClick={onSearch}><Icon name="search" />すべての端末を探す</button>
        <button className={`tsheet-conn ${connectionBad ? 'bad' : ''}`} aria-label={`接続状態：${connection}`} title="接続状態" onClick={onConnection}>
          <span className="conn-dot" aria-hidden="true" />{connection}
        </button>
      </div>
      <div className="tsheet-workspaces" role="group" aria-label="ワークスペース">
        <span className="tsheet-label">ワークスペース</span>
        <div className="tsheet-ws-list">
          {workspaces.map((ws, index) => <button key={ws.id} className={`tsheet-ws ${ws.id === activeWorkspace ? 'on' : ''}`}
            aria-current={ws.id === activeWorkspace ? 'true' : undefined}
            title={`${ws.name}（長押し・右クリックでメニュー）`} aria-haspopup="menu"
            {...press.bind(ws.id)}
            onContextMenu={e => {
              e.preventDefault(); press.cancel();
              const r = e.currentTarget.getBoundingClientRect();
              onWorkspaceMenu(ws.id, e.clientX || r.left, e.clientY || r.bottom);
            }}
            onKeyDown={e => {
              if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                onWorkspaceMenu(ws.id, r.left, r.bottom);
              }
            }}
            onClick={() => onSelectWorkspace(ws.id)}>
            <span className="desktop-number">{index + 1}</span><span>{ws.name}</span>
          </button>)}
          <button className="tsheet-ws tsheet-ws-add" aria-label="新しいワークスペース" title="新しいワークスペース" onClick={onNewWorkspace}><Icon name="plus-square" /></button>
        </div>
      </div>
      {groups.length === 0 && <p className="tsheet-empty">このワークスペースにはタブがありません。＋ で新しい端末を開けます。</p>}
      {groups.map(group => <section key={group.leafId} className="tsheet-panel" aria-label={`パネル「${group.name}」`}>
        <h3 className="tsheet-label">パネル「{group.name}」{group.focused && <span> · 入力先</span>}</h3>
        <ul>
          {group.tabs.map(tab => {
            const current = tab.active && group.focused;
            return <li key={tab.id} className="tsheet-row">
              <button className="tsheet-tab" data-sheet-tab={tab.id} aria-current={current ? 'true' : undefined}
                onClick={() => onPickTab(group.leafId, tab.id)}>
                {tab.screen ? <span className="tab-kind" aria-hidden="true"><Icon name="screen" /></span> : <span className={`state-dot ${tab.kind ?? 'idle'}`} aria-hidden="true" />}
                <span className="tsheet-text">
                  <span className="tsheet-title">{tab.title}{tab.remote && <span className="tsheet-device"> · {tab.device}</span>}</span>
                  <span className="tsheet-task">{tab.task}</span>
                </span>
                {tab.active && <span className="tsheet-check" aria-label={current ? '選択中' : '表示中'} title={current ? '選択中' : 'このパネルで表示中'}>✓</span>}
              </button>
              <button className="icon-btn tsheet-more" aria-label={`「${tab.title}」のタブの操作`} aria-haspopup="menu"
                onClick={e => { const r = e.currentTarget.getBoundingClientRect(); onTabMenu(tab.id, r.right, r.bottom); }}><Icon name="more" /></button>
            </li>;
          })}
        </ul>
      </section>)}
    </div>
  </dialog>;
}
