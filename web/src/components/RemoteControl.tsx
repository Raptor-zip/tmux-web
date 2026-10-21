import { useEffect, useState } from 'react';
import { remoteControl } from '../api';
import { Modal } from './Modal';

export function RemoteControl({ pane, onClose }: { pane: string; onClose(): void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    async function connect() {
      try {
        const data = await remoteControl(pane, attempts++ === 0);
        if (stopped) return;
        if (data.url) setUrl(data.url);
        else if (attempts < 20) timer = setTimeout(connect, 1500);
        else setError('接続URLを取得できませんでした。端末の表示を確認してから、もう一度お試しください。');
      } catch (error) { if (!stopped) setError((error as Error).message); }
    }
    void connect();
    return () => { stopped = true; clearTimeout(timer); };
  }, [pane]);
  return <Modal title="Claude アプリに接続" onClose={onClose}><div className="remote-control-content">
    {error ? <p role="alert" className="inline-error">{error}</p> : url ? <><p>この端末のClaudeを、Claudeアプリから操作できます。</p><a className="btn primary" href={url} target="_blank" rel="noopener noreferrer">Claude アプリで開く</a></> : <p role="status">接続を準備しています。端末で確認を求められた場合は、そちらで操作してください。</p>}
    <footer className="app-modal-actions"><button className="btn" onClick={onClose}>閉じる</button></footer>
  </div></Modal>;
}
