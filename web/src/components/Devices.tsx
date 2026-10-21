import { useRef, useState } from 'react';
import { addDevice, removeDevice, updateDevice } from '../api';
import type { Device } from '../devices';
import { Modal } from './Modal';

export function Devices({ devices, onChanged, onClose }: { devices: Device[]; onChanged(): void; onClose(): void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('DGX Spark');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const perform = async (run: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await run(); onChanged(); } catch (err) { setError((err as Error).message); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Modal title="デバイス接続" onClose={onClose} busy={busy}>
    <div className="project-form">
      <p className="field-hint">各デバイスで起動している tmux-web のURLを登録します。接続はこのPCが中継します。</p>
      {devices.map(device => <div className="device-row" key={device.id}>
        <span className={`dot ${device.connected ? 'ok' : 'bad'}`} />
        <span><strong>{device.name}</strong><small>{device.local ? 'この画面の配信元' : device.url}</small><small>{device.error}</small></span>
        {!device.local && <button className="btn ghost" disabled={busy} onClick={() => { setEditing(device.id); setName(device.name); setUrl(device.url || ''); setError(''); }}>編集</button>}
        {!device.local && <button className="btn ghost" disabled={busy} onClick={() => void perform(() => removeDevice(device.id))}>登録を解除</button>}
      </div>)}
      <form onSubmit={e => { e.preventDefault(); void perform(async () => { if (editing) await updateDevice(editing, { name, url }); else await addDevice({ name, url }); setEditing(null); setName('DGX Spark'); setUrl(''); }); }}>
        <fieldset disabled={busy}>
          <label className="project-field">表示名<input required maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="project-field">接続先URL<input required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://spark-….ts.net:8443" /></label>
        </fieldset>
        <p className="field-hint">接続先もTailscale認証に対応したtmux-webに更新してください。Tailscaleが確認したアカウントで自動認証します。</p>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <footer className="app-modal-actions">{editing && <button type="button" className="btn" disabled={busy} onClick={() => { setEditing(null); setName('DGX Spark'); setUrl(''); }}>キャンセル</button>}<button className="btn primary" disabled={busy}>{busy ? '保存中…' : editing ? '接続設定を保存' : 'デバイスを追加'}</button></footer>
      </form>
    </div>
  </Modal>;
}
