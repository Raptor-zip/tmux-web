import { useLayoutEffect, useRef, useState } from 'react';
import { activeTab, isScreenTab, type LeafNode, type TerminalTab } from '../layout';
import type { Device } from '../devices';
import { RemoteScreen, type ScreenHandle } from './RemoteScreen';
import { TerminalView, type TerminalHandle, type TerminalStatus } from './Terminal';

/** タイルの前面のタブを操作する取っ手。端末かリモートデスクトップか */
export type TabHandle = TerminalHandle | ScreenHandle;

export function isTerminalHandle(handle: TabHandle | null | undefined): handle is TerminalHandle {
  return !!handle && !('kind' in handle && handle.kind === 'screen');
}

interface Props {
  leaf: LeafNode;
  visible: boolean;
  clipboardEnabled: boolean;
  pendingRemap: boolean;
  deviceName?: string;
  devices: Device[];
  windowIndex(tab: TerminalTab): number | null;
  mode: 'mirror' | 'direct';
  showStatusBar: boolean;
  fontSize: number;
  lineHeight: number;
  /** タイル見出しの差し込み口。前面の画面タブが状態・見るだけ・⌨・Esc をここへ出す */
  headSlot?: HTMLElement | null;
  /** タイル見出しが隠れている（スマホ）。画面タブは状態を画面の右上に重ねる */
  floatHead?: boolean;
  registerTerm(leafId: string, handle: TabHandle | null): void;
  onStatus(leafId: string, status: TerminalStatus): void;
  onContextMenu(x: number, y: number): void;
  onCopied(text: string): void;
  onNotice(text: string): void;
}

/**
 * 訪問済みタブは接続と画面を残し、選択したタブだけを見せる。
 * リモートデスクトップのタブは、隠れて一定時間経つと自分で切断する（RemoteScreen）。
 */
export function TerminalTabs(props: Props) {
  const { leaf, visible, pendingRemap, registerTerm, onStatus } = props;
  const selected = activeTab(leaf);
  const visited = useRef(new Set<string>());
  if (visible && selected) visited.current.add(selected.id);
  const handles = useRef(new Map<string, TabHandle>());
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

  // 画面タブは自分で接続状態と再接続を出すので、端末用の「未接続」表示は重ねない
  const status = selected && !isScreenTab(selected) ? statuses.current.get(selected.id) : undefined;
  const bindHandle = (tabId: string) => (handle: TabHandle | null) => {
    if (handle) handles.current.set(tabId, handle);
    else handles.current.delete(tabId);
    const current = latest.current;
    if (activeTab(current.leaf)?.id === tabId) current.registerTerm(current.leaf.id, handle);
  };
  const reportStatus = (tabId: string) => (status: TerminalStatus) => {
    statuses.current.set(tabId, status);
    const current = latest.current;
    if (activeTab(current.leaf)?.id === tabId) {
      refreshStatus(value => value + 1);
      current.onStatus(current.leaf.id, status);
    }
  };
  return <>
    {leaf.tabs.filter(tab => visited.current.has(tab.id)).map(tab => isScreenTab(tab) ? <RemoteScreen
      key={tab.id}
      ref={bindHandle(tab.id)}
      variant="tile"
      deviceId={tab.deviceId}
      devices={props.devices}
      visible={visible && selected?.id === tab.id}
      clipboardEnabled={props.clipboardEnabled && selected?.id === tab.id}
      headSlot={selected?.id === tab.id ? props.headSlot : null}
      floatHead={props.floatHead}
      onStatus={reportStatus(tab.id)}
    /> : <TerminalView
      key={tab.id}
      ref={bindHandle(tab.id)}
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
      onStatus={reportStatus(tab.id)}
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
