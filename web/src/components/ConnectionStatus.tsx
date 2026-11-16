import { useEffect, useId, useRef } from 'react';
import type { Device } from '../devices';
import { Icon } from './Icon';

/** 上バーの接続状態。正常なら点だけ、異常なら『切断』『同期待ち』『認証が必要』を文字で出す */
/** 正常のときの言い方。スマホの ⋯ とタブ一覧の項目に使う */
export const connectionSummary = (label: string | null, partial: boolean) => label ?? (partial ? '一部のデバイスが未接続' : '接続済み');

export function connectionLabel({ connected, unauthorized, hasState, syncOk }: {
  connected: boolean; unauthorized: boolean; hasState: boolean; syncOk: boolean;
}): string | null {
  if (unauthorized) return '認証が必要';
  // 一度も状態を受け取っていないうちは、まだつなぎに行っている途中
  if (!connected) return hasState ? '切断' : '接続中';
  if (!syncOk) return '同期待ち';
  return null;
}

const deviceState = (device: Device) => device.connected ? '接続済み' : device.error && device.error !== '接続中…' ? '切断' : '接続中';

interface Props {
  label: string | null;
  devices: Device[];
  /** ワークスペースの同期のエラー（あれば） */
  syncError?: string;
  authUrl?: string;
  version?: string;
  onReconnect(): void;
  onManageDevices(): void;
  /** 『表示と接続』を開く */
  onOpenSettings(): void;
  /** ポップオーバーの開閉。スマホでは点を見出しに置かないので、⋯ とタブ一覧から開く（Desktops.tsx が持つ） */
  open: boolean;
  onOpenChange(open: boolean): void;
}

/**
 * 接続状態のチップとポップオーバー。
 * ポップオーバー：デバイスごとの状態 / 再接続 / 接続先を開く / デバイス接続を管理… / 表示と接続… / バージョン。
 */
export function ConnectionStatus({ label, devices, syncError, authUrl, version, onReconnect, onManageDevices, onOpenSettings, open, onOpenChange: setOpen }: Props) {
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const remoteDown = devices.some(d => !d.local && !d.connected);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('button, a')?.focus();
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [open, setOpen]);
  const close = () => { setOpen(false); button.current?.focus(); };
  const name = label ?? '接続状態';
  return <div className="conn-status-wrap"
    onKeyDown={e => { if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
    <button ref={button} className={`bar-chip conn-status ${label ? 'bad' : remoteDown ? 'partial' : 'ok'}`}
      aria-label={label ? undefined : name} title={name}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(!open)}>
      <span className="conn-dot" aria-hidden="true" />
      {label && <span className="bar-chip-text">{label}</span>}
    </button>
    {open && <div ref={panel} id={id} className="conn-popover" role="dialog" aria-label="接続状態">
      <ul className="conn-devices">
        {devices.map(device => <li key={device.id} className={device.connected ? 'ok' : 'bad'}>
          <span className="conn-dot" aria-hidden="true" />
          <span className="conn-device-name">{device.name}</span>
          <span className="conn-device-state" title={device.error || undefined}>{deviceState(device)}</span>
          {device.server?.version && <span className="conn-device-version">{device.server.version}</span>}
        </li>)}
      </ul>
      {syncError && <p className="conn-note">ワークスペースの同期：{syncError}</p>}
      <div className="conn-actions">
        <button className="btn" onClick={() => { onReconnect(); close(); }}><Icon name="refresh" />再接続</button>
        {authUrl && <a className="btn" href={authUrl}>接続先を開く</a>}
        <button className="btn" onClick={() => { close(); onManageDevices(); }}>デバイス接続を管理…</button>
        <button className="btn" onClick={() => { close(); onOpenSettings(); }}>表示と接続…</button>
      </div>
      {version && <p className="conn-note">バージョン {version}</p>}
    </div>}
  </div>;
}
