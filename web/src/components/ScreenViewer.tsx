import type { Device } from '../devices';
import { useEffect, useRef, useState } from 'react';
import { fetchDesktopStatus, measureDesktopRoundTrip, readDesktopClipboard, writeDesktopClipboard, wsUrl } from '../api';
import { DESKTOP_SETTINGS_KEY, desktopPresets, loadDesktopSettings, type DesktopSettings } from '../desktop-settings';
import type { LosslessRFB } from '../vendor/lossless-rfb';
import { Icon } from './Icon';

export function ScreenViewer({ deviceName, deviceId = 'local', devices = [], onClose }: { deviceName?: string; deviceId?: string; devices?: Device[]; onClose(): void }) {
  const [selectedDeviceId, setSelectedDeviceId] = useState(deviceId);
  const selectedDevice = devices.find(device => device.id === selectedDeviceId);
  const selectedName = selectedDevice?.name || deviceName || 'デバイス';
  const selectionVersion = useRef(0);
  const selectedIdRef = useRef(selectedDeviceId);
  selectedIdRef.current = selectedDeviceId;
  const [attempt, setAttempt] = useState(0);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('デスクトップに接続中…');
  const [error, setError] = useState('');
  const [fit, setFit] = useState(true);
  const [viewOnly, setViewOnly] = useState(false);
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
  const [copying, setCopying] = useState(false);
  const copyLock = useRef(false);
  const clipboardText = useRef<HTMLTextAreaElement>(null);
  const [full, setFull] = useState(false);
  const [settings, setSettings] = useState(loadDesktopSettings);
  const [draft, setDraft] = useState(settings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roundTrip, setRoundTrip] = useState<number | null>(null);
  const [sourceSize, setSourceSize] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const client = useRef<LosslessRFB | null>(null);
  const fitRef = useRef(fit); fitRef.current = fit;
  const viewRef = useRef(viewOnly); viewRef.current = viewOnly;
  const closeRef = useRef(onClose); closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      // Escape/Tab inside the desktop belong to the remote application.
      if (viewport.current?.contains(e.target as Node)) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); }
      if (e.key === 'Tab') {
        const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary, textarea, select, input:not(:disabled), canvas') ?? [])].filter(el=>el.getClientRects().length);
        const first = elements[0], last = elements[elements.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { e.preventDefault(); first?.focus(); }
      }
    };
    const fullscreen = () => setFull(document.fullscreenElement === panel.current);
    document.addEventListener('keydown', key);
    document.addEventListener('fullscreenchange', fullscreen);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('fullscreenchange', fullscreen);
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let rfb: LosslessRFB | null = null;
    viewport.current?.replaceChildren();
    setConnected(false); setError(''); setSourceSize(''); setMessage('デスクトップを確認中…');
    void fetchDesktopStatus(controller.signal, selectedDeviceId).then(async status => {
      if (controller.signal.aborted) return;
      if (!status.available) throw new Error(status.error || 'デスクトップに接続できません');
      setSourceSize(`${status.width}×${status.height}`);
      const { LosslessRFB } = await import('../vendor/lossless-rfb');
      if (controller.signal.aborted) return;
      setMessage('デスクトップに接続中…');
      rfb = new LosslessRFB(viewport.current!, wsUrl('/ws/desktop', { scale: settings.scale, interval: settings.interval }, selectedDeviceId));
      rfb.lossless = settings.lossless;
      client.current = rfb;
      rfb.scaleViewport = fitRef.current;
      rfb.clipViewport = false;
      rfb.resizeSession = false;
      rfb.viewOnly = viewRef.current;
      rfb.compressionLevel = settings.compression;
      rfb.qualityLevel = settings.quality;
      rfb.addEventListener('connect', () => {
        if (controller.signal.aborted) return;
        setConnected(true); setMessage('接続済み');
      });
      rfb.addEventListener('disconnect', () => {
        if (controller.signal.aborted) return;
        setConnected(false); setError('接続が切れました。「再接続」で接続し直してください。');
      });
      rfb.addEventListener('securityfailure', () => {
        if (!controller.signal.aborted) setError('デスクトップへの認証に失敗しました。');
      });
      rfb.addEventListener('clipboard', event => {
        if (controller.signal.aborted) return;
        const value = (event as CustomEvent<{ text: string }>).detail.text;
        setText(value); setNotice('リモートのクリップボードを受信しました');
      });
    }).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => { controller.abort(); rfb?.disconnect(); client.current = null; };
  }, [attempt, settings, selectedDeviceId]);

  useEffect(() => {
    if (!connected) { setRoundTrip(null); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const measure = async () => {
      // Include server/network contention, but do not label this as display latency.
      try {
        const value = await measureDesktopRoundTrip(AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]), selectedDeviceId);
        if (!controller.signal.aborted) setRoundTrip(value);
      } catch { if (!controller.signal.aborted) setRoundTrip(null); }
      if (!controller.signal.aborted) timer = setTimeout(() => void measure(), 5000);
    };
    void measure();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [connected, selectedDeviceId]);

  useEffect(() => { if (client.current) client.current.scaleViewport = fit; }, [fit]);
  useEffect(() => { if (client.current) client.current.viewOnly = viewOnly; }, [viewOnly]);

  const applySettings = (value: DesktopSettings) => {
    // Save only on apply: moving a slider must not repeatedly reconnect.
    const next = { lossless: value.lossless, quality: value.quality, compression: value.compression, scale: value.scale, interval: value.interval };
    try { localStorage.setItem(DESKTOP_SETTINGS_KEY, JSON.stringify(next)); } catch { /* Storage may be unavailable. */ }
    setSettings(next); setDraft(next); setSettingsOpen(false);
  };

  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await panel.current?.requestFullscreen();
    } catch { setNotice('このブラウザでは全画面表示を利用できません'); }
  };
  const paste = async () => {
    const rfb = client.current;
    try { await writeDesktopClipboard(text, selectedDeviceId); }
    catch (err) { setNotice((err as Error).message); return; }
    if (selectedIdRef.current !== selectedDeviceId || client.current !== rfb || !rfb) return;
    client.current?.sendKey(0xffe3, 'ControlLeft', true);
    client.current?.sendKey(0x76, 'KeyV');
    client.current?.sendKey(0xffe3, 'ControlLeft', false);
    setNotice('リモートへ貼り付けました');
    client.current?.focus();
  };
  const copy = async () => {
    if (copyLock.current) return;
    copyLock.current = true; setCopying(true); setNotice('');
    const version = selectionVersion.current;
    const isCurrent = () => selectionVersion.current === version && selectedIdRef.current === selectedDeviceId && panel.current !== null;
    try {
      const received = readDesktopClipboard(selectedDeviceId).then(({ text: value }) => {
        if (!isCurrent()) throw new Error('接続先が変更されました');
        return value;
      });
      let written = false;
      // Start the browser write during the click, before the network response.
      // This preserves user activation in browsers that require it (e.g. Safari).
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        try {
          const data = received.then(value => {
            if (!value) throw new Error('クリップボードが空です');
            return new Blob([value], { type: 'text/plain' });
          });
          // A denied write may never consume the promised data.
          void data.catch(() => {});
          await navigator.clipboard.write([new ClipboardItem({ 'text/plain': data })]);
          written = true;
        } catch { /* Retry with writeText or offer the received text for manual copy. */ }
      }
      const value = await received;
      if (!isCurrent()) return;
      if (!value) { setNotice('接続先のクリップボードに文字がありません'); return; }
      setText(value);
      if (!written) {
        try { await navigator.clipboard.writeText(value); written = true; }
        catch { /* Some browsers deny clipboard access or require HTTPS. */ }
      }
      if (!isCurrent()) return;
      if (written) setNotice('接続先の文字を、この端末のクリップボードにコピーしました');
      else {
        setClipboardOpen(true); setSettingsOpen(false);
        setNotice('自動コピーが許可されていません。入力欄の文字を選択してコピーしてください');
        requestAnimationFrame(() => { if (isCurrent()) { clipboardText.current?.focus(); clipboardText.current?.select(); } });
      }
    } catch (err) { if (isCurrent()) setNotice((err as Error).message); }
    finally { copyLock.current = false; setCopying(false); }
  };

  return <div className="modal-backdrop desktop-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
    <div className="screen-viewer desktop-viewer" role="dialog" aria-modal="true" aria-label="リモートデスクトップ" tabIndex={-1} ref={panel}>
      <div className="screen-head">
        <strong><Icon name="screen" /> <span>リモートデスクトップ</span></strong>
        <button className="btn desktop-close-viewer" aria-label="デスクトップを閉じる" onClick={onClose}><Icon name="close" />閉じる</button>
      </div>
      <div className="desktop-toolbar">
        <div className="desktop-connection-row">
          <label className="desktop-device-label">接続先
            {devices.length > 1 ? <select aria-label="デスクトップのデバイス" value={selectedDeviceId} onChange={event => {
              selectionVersion.current++; selectedIdRef.current = event.target.value;
              setText(''); setNotice(''); setRoundTrip(null); setSelectedDeviceId(event.target.value);
            }}>
              {devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}
            </select> : <strong>{selectedName}</strong>}
          </label>
          <span className={`desktop-connection-status ${connected ? 'is-connected' : ''}`} role="status"><span className={`dot ${connected ? 'ok' : error ? 'bad' : ''}`} />{connected ? '接続済み' : error ? '未接続' : '接続中…'}</span>
          <button className="btn" onClick={() => setAttempt(v => v + 1)}><Icon name="refresh" />再接続</button>
        </div>
        <div className="desktop-action-row">
          <div className="desktop-mode" role="group" aria-label="リモートの操作モード">
            <button className="btn" aria-pressed={!viewOnly} onClick={() => setViewOnly(false)}>操作する</button>
            <button className="btn" aria-pressed={viewOnly} onClick={() => setViewOnly(true)}>見るだけ</button>
          </div>
          <div className="desktop-display-controls">
            <label className="desktop-display-label">表示<select aria-label="デスクトップの表示サイズ" value={fit ? 'fit' : 'actual'} onChange={e => setFit(e.target.value === 'fit')}>
              <option value="fit">画面に合わせる</option><option value="actual">原寸（100%）</option>
            </select></label>
            <button className="btn" onClick={() => void fullscreen()}><Icon name="expand" />{full ? '全画面を終了' : '全画面'}</button>
          </div>
          <div className="desktop-tools">
            <button className="btn desktop-copy-button" disabled={copying} onClick={() => void copy()} title="接続先のクリップボードの文字を、この端末にコピー"><Icon name="download" />{copying ? 'コピー中…' : 'この端末へコピー'}</button>
            <button className="btn" aria-expanded={clipboardOpen} aria-controls="desktop-clipboard-panel" onClick={() => { setClipboardOpen(v => !v); setSettingsOpen(false); }}><Icon name="keyboard" />文字入力・コピー</button>
            <button className="btn" aria-expanded={settingsOpen} aria-controls="desktop-settings-panel" onClick={() => { setSettingsOpen(v => !v); setClipboardOpen(false); }}>画質・遅延設定</button>
          </div>
        </div>
        <div className="desktop-input-row">
          <span>{viewOnly ? '見るだけ：マウス・キー操作は送信しません' : '画面をクリックするとマウス・キーボードで操作できます'}</span>
          <div role="group" aria-label="リモートへキーを送信">
            <button className="btn" disabled={!connected || viewOnly} onClick={() => { client.current?.sendKey(0xff1b, 'Escape'); client.current?.focus(); }}>Esc を送る</button>
            <button className="btn" disabled={!connected || viewOnly} onClick={() => { client.current?.sendCtrlAltDel(); client.current?.focus(); }}>Ctrl+Alt+Del を送る</button>
          </div>
        </div>
      </div>
      {settingsOpen && <div className="desktop-settings" id="desktop-settings-panel">
        <div className="screen-controls" role="group" aria-label="配信プリセット">
          {Object.entries(desktopPresets).map(([id, preset]) => <button key={id} className="btn" onClick={() => setDraft(preset)}>{preset.label}</button>)}
        </div>
        <div className="desktop-settings-fields">
          <label>画質方式<select value={draft.lossless ? 'lossless' : 'jpeg'} onChange={e => setDraft(v => ({ ...v, lossless: e.target.value === 'lossless' }))}>
            <option value="jpeg">JPEG（通信量を削減）</option><option value="lossless">可逆圧縮（文字を鮮明に）</option>
          </select></label>
          <label>配信サイズ<select value={draft.scale} onChange={e => setDraft(v => ({ ...v, scale: e.target.value as DesktopSettings['scale'] }))}>
            <option value="1">100%（原寸）</option><option value="0.75">75%</option><option value="0.5">50%</option>
          </select></label>
          <label>更新間隔<select value={draft.interval} onChange={e => setDraft(v => ({ ...v, interval: e.target.value as DesktopSettings['interval'] }))}>
            <option value="16">16 ms（滑らか・高負荷）</option><option value="33">33 ms（標準）</option><option value="66">66 ms（負荷を抑える）</option><option value="100">100 ms（省通信）</option>
          </select></label>
          <label>JPEG品質：{draft.quality}<input type="range" min="0" max="9" value={draft.quality} disabled={draft.lossless} onChange={e => setDraft(v => ({ ...v, quality: Number(e.target.value) }))} /></label>
          <label>圧縮レベル：{draft.compression}<input type="range" min="0" max="9" value={draft.compression} onChange={e => setDraft(v => ({ ...v, compression: Number(e.target.value) }))} /></label>
        </div>
        <p>遅いときは「低遅延」、文字を読むときは「文字くっきり」。圧縮を上げると通信量は減り、処理負荷は増えます。配信サイズはこの接続だけに適用します。更新間隔は目安で、FPSの保証ではありません。</p>
        <div className="screen-controls">
          <button className="btn" onClick={() => applySettings(draft)}>適用して再接続</button>
          <button className="btn" onClick={() => { setDraft(settings); setSettingsOpen(false); }}>キャンセル</button>
        </div>
      </div>}
      {clipboardOpen && <div className="desktop-clipboard" id="desktop-clipboard-panel">
        <label htmlFor="desktop-text">文字入力・クリップボード（日本語入力可）</label>
        <textarea ref={clipboardText} id="desktop-text" value={text} onChange={e => setText(e.target.value)} placeholder="ここに入力して、リモートへ貼り付け" />
        <div className="screen-controls">
          <button className="btn primary" disabled={!connected || viewOnly} onClick={() => void paste()}>接続先へ貼り付け</button>
          <button className="btn" disabled={copying} onClick={() => void copy()}>{copying ? 'コピー中…' : '接続先からコピー'}</button>
        </div>
      </div>}
      <div className="desktop-stage">
        <div className="desktop-viewport" ref={viewport} aria-label="デスクトップ操作領域" />
        {!connected && <div className="desktop-message"><div className="desktop-message-content">
          <Icon name="screen" width="32" height="32" />
          <strong>{error ? 'デスクトップに接続できません' : message}</strong>
          <p role={error ? 'alert' : 'status'}>{error || `${selectedName} の画面を準備しています。`}</p>
          {error && <button className="btn primary" onClick={() => setAttempt(v => v + 1)}><Icon name="refresh" />もう一度接続する</button>}
        </div></div>}
      </div>
      <div className="screen-foot desktop-footer">
        {notice && <p className="desktop-notice" role="status">{notice}</p>}
        <details><summary>操作ガイド・接続情報</summary>
          <p>スマホ：タップでクリック、2本指タップで右クリック、2本指ドラッグでスクロール。日本語は「文字入力・コピー」から送れます。</p>
          <p>{settings.lossless ? '可逆圧縮' : `JPEG 品質${settings.quality}`} · 配信{Math.round(Number(settings.scale) * 100)}%（元画面 {sourceSize || '確認中'}） · 更新{settings.interval}ms · 音声なし</p>
          <p>通信往復：{roundTrip === null ? '未計測／応答なし' : `${roundTrip} ms`}。画面の取り込み・圧縮・描画時間は含みません。</p>
        </details>
      </div>
    </div>
  </div>;
}
