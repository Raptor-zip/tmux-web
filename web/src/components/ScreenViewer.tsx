import { useEffect, useRef, useState } from 'react';
import { fetchDesktopStatus, readDesktopClipboard, writeDesktopClipboard, wsUrl } from '../api';
import type { LosslessRFB } from '../vendor/lossless-rfb';
import { Icon } from './Icon';

export function ScreenViewer({ deviceName, onClose }: { deviceName?: string; onClose(): void }) {
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
        const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea, canvas') ?? [])];
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
    void fetchDesktopStatus(controller.signal).then(async status => {
      if (controller.signal.aborted) return;
      if (!status.available) throw new Error(status.error || 'デスクトップに接続できません');
      const { LosslessRFB } = await import('../vendor/lossless-rfb');
      if (controller.signal.aborted) return;
      setMessage('デスクトップに接続中…');
      rfb = new LosslessRFB(viewport.current!, wsUrl('/ws/desktop'));
      client.current = rfb;
      rfb.scaleViewport = fitRef.current;
      rfb.clipViewport = false;
      rfb.resizeSession = false;
      rfb.viewOnly = viewRef.current;
      rfb.compressionLevel = 2;
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
  }, [attempt]);

  useEffect(() => { if (client.current) client.current.scaleViewport = fit; }, [fit]);
  useEffect(() => { if (client.current) client.current.viewOnly = viewOnly; }, [viewOnly]);

  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await panel.current?.requestFullscreen();
    } catch { setNotice('このブラウザでは全画面表示を利用できません'); }
  };
  const paste = async () => {
    const rfb = client.current;
    try { await writeDesktopClipboard(text); }
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
      const { text: received } = await readDesktopClipboard();
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
        <button className="btn" aria-pressed={viewOnly} onClick={() => setViewOnly(v => !v)}>{viewOnly ? '閲覧のみ' : '操作有効'}</button>
        <button className="btn" aria-expanded={clipboardOpen} onClick={() => setClipboardOpen(v => !v)}>文字・クリップボード</button>
        <button className="btn" disabled={!connected || viewOnly} onClick={() => { client.current?.sendKey(0xff1b, 'Escape'); client.current?.focus(); }}>Esc</button>
        <button className="btn" disabled={!connected || viewOnly} onClick={() => { client.current?.sendCtrlAltDel(); client.current?.focus(); }}>Ctrl+Alt+Del</button>
        <button className="btn" onClick={() => setAttempt(v => v + 1)}>再接続</button>
      </div>
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
        {connected ? '接続済み' : error ? '未接続' : message} · 可逆圧縮・元の解像度 · {viewOnly ? '閲覧のみ' : 'マウス・キーボード操作'} · 音声なし
        <span className="desktop-hint">スマホ：タップでクリック、2本指タップで右クリック、2本指ドラッグでスクロール</span>
        {notice && <span>{notice}</span>}
      </div>
    </div>
  </div>;
}
