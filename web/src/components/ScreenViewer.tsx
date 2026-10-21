import { useEffect, useRef, useState } from 'react';
import { fetchDesktopStatus, measureDesktopRoundTrip, readDesktopClipboard, writeDesktopClipboard, wsUrl } from '../api';
import { DESKTOP_SETTINGS_KEY, desktopPresets, loadDesktopSettings, type DesktopSettings } from '../desktop-settings';
import type { LosslessRFB } from '../vendor/lossless-rfb';
import { Icon } from './Icon';

export function ScreenViewer({ deviceName, deviceId = 'local', onClose }: { deviceName?: string; deviceId?: string; onClose(): void }) {
  const [attempt, setAttempt] = useState(0);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('デスクトップに接続中…');
  const [error, setError] = useState('');
  const [fit, setFit] = useState(true);
  const [viewOnly, setViewOnly] = useState(false);
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
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
        const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, select, input:not(:disabled), canvas') ?? [])];
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
    setConnected(false); setError(''); setMessage('デスクトップを確認中…');
    void fetchDesktopStatus(controller.signal, deviceId).then(async status => {
      if (controller.signal.aborted) return;
      if (!status.available) throw new Error(status.error || 'デスクトップに接続できません');
      setSourceSize(`${status.width}×${status.height}`);
      const { LosslessRFB } = await import('../vendor/lossless-rfb');
      if (controller.signal.aborted) return;
      setMessage('デスクトップに接続中…');
      rfb = new LosslessRFB(viewport.current!, wsUrl('/ws/desktop', { scale: settings.scale, interval: settings.interval }, deviceId));
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
  }, [attempt, settings, deviceId]);

  useEffect(() => {
    if (!connected) { setRoundTrip(null); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const measure = async () => {
      // Include server/network contention, but do not label this as display latency.
      try {
        const value = await measureDesktopRoundTrip(AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]), deviceId);
        if (!controller.signal.aborted) setRoundTrip(value);
      } catch { if (!controller.signal.aborted) setRoundTrip(null); }
      if (!controller.signal.aborted) timer = setTimeout(() => void measure(), 5000);
    };
    void measure();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [connected]);

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
    try { await writeDesktopClipboard(text, deviceId); }
    catch (err) { setNotice((err as Error).message); return; }
    if (client.current !== rfb || !rfb) return;
    client.current?.sendKey(0xffe3, 'ControlLeft', true);
    client.current?.sendKey(0x76, 'KeyV');
    client.current?.sendKey(0xffe3, 'ControlLeft', false);
    setNotice('リモートへ貼り付けました');
    client.current?.focus();
  };
  const copy = async () => {
    try {
      const { text: received } = await readDesktopClipboard(deviceId);
      setText(received);
      try { await navigator.clipboard.writeText(received); setNotice('この端末にコピーしました'); }
      catch { setNotice('入力欄に取得しました。テキストを選択してコピーしてください'); }
    } catch (err) { setNotice((err as Error).message); }
  };

  return <div className="modal-backdrop desktop-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
    <div className="screen-viewer desktop-viewer" role="dialog" aria-modal="true" aria-label="リモートデスクトップ" tabIndex={-1} ref={panel}>
      <div className="screen-head">
        <strong><Icon name="screen" /> <span>{deviceName || 'デバイス'} のデスクトップ</span></strong>
        <button className="icon-btn" aria-label="デスクトップを閉じる" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="screen-controls">
        <button className="btn" aria-pressed={!fit} onClick={() => setFit(v => !v)}>{fit ? '原寸表示' : '画面に合わせる'}</button>
        <button className="btn" onClick={() => void fullscreen()}>{full ? '全画面を終了' : '全画面'}</button>
        <button className="btn" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(v => !v)}>画質・遅延設定</button>
        <button className="btn" aria-pressed={viewOnly} onClick={() => setViewOnly(v => !v)}>{viewOnly ? '閲覧のみ' : '操作有効'}</button>
        <button className="btn" aria-expanded={clipboardOpen} onClick={() => setClipboardOpen(v => !v)}>文字・クリップボード</button>
        <button className="btn" disabled={!connected || viewOnly} onClick={() => { client.current?.sendKey(0xff1b, 'Escape'); client.current?.focus(); }}>Esc</button>
        <button className="btn" disabled={!connected || viewOnly} onClick={() => { client.current?.sendCtrlAltDel(); client.current?.focus(); }}>Ctrl+Alt+Del</button>
        <button className="btn" onClick={() => setAttempt(v => v + 1)}>再接続</button>
      </div>
      {settingsOpen && <div className="desktop-settings">
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
      {clipboardOpen && <div className="desktop-clipboard">
        <label htmlFor="desktop-text">送る文字（日本語入力可）・リモートでコピーした文字</label>
        <textarea id="desktop-text" value={text} onChange={e => setText(e.target.value)} placeholder="ここに入力して、リモートへ貼り付け" />
        <div className="screen-controls">
          <button className="btn" disabled={!connected || viewOnly} onClick={() => void paste()}>リモートへ貼り付け</button>
          <button className="btn" disabled={!connected} onClick={() => void copy()}>リモートからコピー</button>
        </div>
      </div>}
      <div className="desktop-stage">
        <div className="desktop-viewport" ref={viewport} aria-label="デスクトップ操作領域" />
        {!connected && <p role="status" className="screen-message desktop-message">{error || message}</p>}
      </div>
      <div className="screen-foot" role="status">
        {connected ? '接続済み' : error ? '未接続' : message} · {settings.lossless ? '可逆圧縮' : `JPEG 品質${settings.quality}`} · 配信{Math.round(Number(settings.scale) * 100)}%（元画面 {sourceSize || '確認中'}） · 更新{settings.interval}ms · {viewOnly ? '閲覧のみ' : 'マウス・キーボード操作'} · 音声なし
        <span className="desktop-hint" title="通信往復はHTTPの応答時間です。画面の取り込み・圧縮・描画時間は含みません。">通信往復：{roundTrip === null ? '計測中／応答なし' : `${roundTrip} ms`}（画面遅延とは異なります）</span>
        <span className="desktop-hint">スマホ：タップでクリック、2本指タップで右クリック、2本指ドラッグでスクロール</span>
        {notice && <span>{notice}</span>}
      </div>
    </div>
  </div>;
}
