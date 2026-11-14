import { useLayoutEffect, useRef, useState } from 'react';
import { activeTab, type LeafNode, type TabRef } from '../layout';
import { TerminalView, type TerminalHandle, type TerminalStatus } from './Terminal';

interface Props {
  leaf: LeafNode;
  visible: boolean;
  pendingRemap: boolean;
  deviceName?: string;
  windowIndex(tab: TabRef): number | null;
  mode: 'mirror' | 'direct';
  showStatusBar: boolean;
  fontSize: number;
  lineHeight: number;
  registerTerm(leafId: string, handle: TerminalHandle | null): void;
  onStatus(leafId: string, status: TerminalStatus): void;
  onContextMenu(x: number, y: number): void;
  onCopied(text: string): void;
  onNotice(text: string): void;
}

/** 訪問済みタブは接続と画面を残し、選択したタブだけを見せる。 */
export function TerminalTabs(props: Props) {
  const { leaf, visible, pendingRemap, registerTerm, onStatus } = props;
  const selected = activeTab(leaf);
  const visited = useRef(new Set<string>());
  if (visible && selected) visited.current.add(selected.id);
  const handles = useRef(new Map<string, TerminalHandle>());
  const statuses = useRef(new Map<string, TerminalStatus>());
  const [, refreshStatus] = useState(0);
  const [retries, setRetries] = useState<Record<string, number>>({});
  const latest = useRef(props);
  latest.current = props;

  // ツールバーやモバイル入力は、前面のタブの端末にだけ送る。
  useLayoutEffect(() => {
    registerTerm(leaf.id, selected ? handles.current.get(selected.id) ?? null : null);
    onStatus(leaf.id, (selected && statuses.current.get(selected.id)) || { connected: false });
    return () => registerTerm(leaf.id, null);
  }, [leaf.id, selected?.id, registerTerm, onStatus]);

  const status = selected ? statuses.current.get(selected.id) : undefined;
  return <>
    {leaf.tabs.filter(tab => visited.current.has(tab.id)).map(tab => <TerminalView
      key={tab.id}
      ref={handle => {
        if (handle) handles.current.set(tab.id, handle);
        else handles.current.delete(tab.id);
        const current = latest.current;
        if (activeTab(current.leaf)?.id === tab.id) current.registerTerm(current.leaf.id, handle);
      }}
      visible={visible && selected?.id === tab.id}
      retryToken={retries[tab.id] || 0}
      sessionId={pendingRemap ? null : tab.sessionId}
      windowId={tab.windowId}
      windowIndex={props.windowIndex(tab)}
      mode={props.mode}
      showStatusBar={props.showStatusBar}
      fontSize={props.fontSize}
      lineHeight={props.lineHeight}
      onContextMenu={props.onContextMenu}
      onStatus={status => {
        statuses.current.set(tab.id, status);
        const current = latest.current;
        if (activeTab(current.leaf)?.id === tab.id) {
          refreshStatus(value => value + 1);
          current.onStatus(current.leaf.id, status);
        }
      }}
      onCopied={props.onCopied}
      onNotice={props.onNotice}
    />)}
    {selected && status && !status.connected && <div className={`panel-connection${status.selecting ? ' selecting' : ''}`} role="status">
      <strong>{props.deviceName || '端末'} · {status.selecting ? '切り替え中' : '未接続'}</strong>
      <span>{status.message || '接続を確認しています…'}</span>
      {!status.selecting && <button onClick={() => setRetries(value => ({ ...value, [selected.id]: (value[selected.id] || 0) + 1 }))}>再接続</button>}
    </div>}
  </>;
}
