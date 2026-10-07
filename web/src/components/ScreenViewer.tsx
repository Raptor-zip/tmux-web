import { useEffect, useRef, useState } from 'react';
import { fetchScreenStatus, screenStreamUrl, type ScreenStatus } from '../api';
import { Icon } from './Icon';

export function ScreenViewer({ deviceName, onClose }: { deviceName?: string; onClose(): void }) {
  const [status, setStatus] = useState<ScreenStatus | null>(null);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') {
        const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { e.preventDefault(); first?.focus(); }
      }
    };
    const visibility = () => setHidden(document.hidden);
    document.addEventListener('keydown', key, true);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('visibilitychange', visibility);
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setStatus(null); setError(''); setLoaded(false);
    fetchScreenStatus(controller.signal).then(setStatus).catch(err => {
      if (!controller.signal.aborted) setError(err.message);
    });
    return () => controller.abort();
  }, [attempt]);
  const streaming = status?.available && !paused && !hidden && !error;
  return <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
    <div className="screen-viewer" role="dialog" aria-modal="true" aria-label="デバイスの画面" tabIndex={-1} ref={panel}>
      <div className="screen-head">
        <strong><Icon name="screen" /> {deviceName || 'デバイス'} の画面</strong>
        <button className="icon-btn" aria-label="画面配信を閉じる" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="screen-controls">
        <button className="btn" disabled={!status?.available} onClick={() => { setPaused(v => !v); setLoaded(false); }}>{paused ? '再開' : '一時停止'}</button>
        <button className="btn" disabled={!status?.available} aria-pressed={zoom} onClick={() => setZoom(v => !v)}>{zoom ? '画面に合わせる' : '拡大して見る'}</button>
        <button className="btn" onClick={() => { setPaused(false); setAttempt(v => v + 1); }}>再接続</button>
      </div>
      <div className={`screen-canvas ${zoom ? 'zoom' : ''}`}>
        {streaming && <img key={attempt} src={screenStreamUrl(attempt)} alt={`${deviceName || 'デバイス'} のデスクトップ画面`}
          onLoad={() => setLoaded(true)} onError={() => setError('画面配信に接続できませんでした。再接続を押してください。')} />}
        {(!streaming || !loaded) && <p role="status" className="screen-message">
          {error || (!status ? '画面を確認中…' : !status.available ? status.error : paused ? '配信を一時停止しました' : hidden ? '非表示の間は配信を停止します' : '画面に接続中…')}
        </p>}
      </div>
      <div className="screen-foot">閲覧のみ · 音声なし{status?.available && ` · ${status.width} × ${status.height} / ${status.fps} fps`}</div>
    </div>
  </div>;
}
