import { useEffect, useState } from 'react';
import { Modal } from './Modal';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const ready = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const done = () => { setInstalled(true); setPrompt(null); setHelp(false); };
    const media = window.matchMedia('(display-mode: standalone)');
    const changed = () => { if (media.matches) done(); };
    window.addEventListener('beforeinstallprompt', ready);
    window.addEventListener('appinstalled', done);
    media.addEventListener('change', changed);
    return () => {
      window.removeEventListener('beforeinstallprompt', ready);
      window.removeEventListener('appinstalled', done);
      media.removeEventListener('change', changed);
    };
  }, []);
  if (installed) return null;
  const install = async () => {
    if (!prompt) { setHelp(true); return; }
    setBusy(true); setError('');
    try { await prompt.prompt(); if ((await prompt.userChoice).outcome === 'accepted') setInstalled(true); }
    catch { setError('ブラウザのメニューからアプリをインストールしてください。'); setHelp(true); }
    finally { setPrompt(null); setBusy(false); }
  };
  return <>
    <button className="app-install" aria-label="アプリとしてインストール" title="アプリとしてインストール" disabled={busy} onClick={() => void install()}><span aria-hidden="true">⇩</span><span className="install-label">アプリとして追加</span></button>
    {help && <Modal title="アプリとして使う" onClose={() => setHelp(false)}>
      <div className="install-help">
        <p>専用ウィンドウで開き、アプリ一覧やDockから起動できます。</p>
        <p>UbuntuのChrome・Braveでは、ブラウザ右上のメニューにある「インストール」または「ページをアプリとしてインストール」を選んでください。項目はブラウザによって異なります。</p>
        <p>起動後にDockのアイコンを右クリックし、「お気に入りに追加」で固定できます。</p>
        <p>iPhone・iPadではSafariの共有メニューから「ホーム画面に追加」を選んでください。</p>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <p className="field-hint">Tailscaleに接続した状態で使えます。タブとデスクトップの配置は、このブラウザと同じ保存先を使います。</p>
      </div>
    </Modal>}
  </>;
}
