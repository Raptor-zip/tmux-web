import { useRef, useState } from 'react';
import { startProject, type StartedProject } from '../api';
import type { Device } from '../devices';

export function DeviceStart({ devices, ready, onStarted, onManageDevices }: {
  devices: Device[];
  ready: boolean;
  onStarted(deviceId: string, project: StartedProject): void;
  onManageDevices(): void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const lock = useRef(false);

  return <section className="device-start" aria-label="ターミナルを開くデバイス">
    <h2>デバイスを選んでターミナルを開く</h2>
    <p className="dim">選んだデバイスのホームディレクトリで開きます。</p>
    {!ready && <p role="status">デバイスを読み込んでいます…</p>}
    <div className="device-start-list">
      {ready && devices.map(device => <button
        key={device.id}
        className="btn device-start-option"
        disabled={busy !== null || !device.connected}
        onClick={async () => {
          if (lock.current) return;
          lock.current = true; setBusy(device.id); setError('');
          try {
            const project = await startProject({ mode: 'existing', dir: '~', agent: 'shell' }, device.id);
            onStarted(device.id, project);
          } catch (err) { setError((err as Error).message); }
          finally { lock.current = false; setBusy(null); }
        }}
      >
        <strong>{device.name}</strong>
        <small>{busy === device.id ? '開いています…' : device.connected ? device.server?.home || '~' : device.error || '接続待ち'}</small>
      </button>)}
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <button className="btn ghost" disabled={busy !== null} onClick={onManageDevices}>デバイス接続を管理</button>
  </section>;
}
