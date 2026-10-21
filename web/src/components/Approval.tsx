import { useEffect, useRef, useState } from 'react';
import { answerApproval, cancelApproval, fetchApproval, type Approval } from '../api';
import { Modal } from './Modal';
import { Icon } from './Icon';

export function useApproval() {
  const [pending, setPending] = useState<Approval | null>(null);
  const [secure, setSecure] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (!document.hidden) {
          const data = await fetchApproval(controller.signal);
          if (!controller.signal.aborted) { setPending(data.pending); setSecure(data.secure); }
        }
      } catch { /* existing request remains visible until expiry or reconnection */ }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2500);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [revision]);
  return { pending, secure, refresh: () => setRevision(v => v + 1) };
}

export function ApprovalNotice({ pending, onOpen }: { pending: Approval; onOpen(): void }) {
  return <div className="approval-notice" role="status"><Icon name="lock" /><strong>sudo 承認待ち</strong><span title={pending.cmd}>{pending.cmd}</span><button className="btn" onClick={onOpen}>内容を確認</button></div>;
}

export function ApprovalDialog({ pending, secure, onClose, onDone }: { pending: Approval; secure: boolean; onClose(): void; onDone(): void }) {
  const [ready, setReady] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const field = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const left = Math.max(0, Math.ceil((pending.expiresAt - now) / 1000));
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 800);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(timer); clearInterval(tick); if (field.current) field.current.value = ''; };
  }, []);
  const perform = async (approve: boolean) => {
    if (lock.current || (approve && (!ready || !secure || !hasPassword || left === 0))) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (approve) await answerApproval(pending.id, field.current?.value || '');
      else await cancelApproval(pending.id);
      onDone();
    } catch (error) { setError((error as Error).message); }
    finally { if (field.current) field.current.value = ''; setHasPassword(false); setBusy(false); lock.current = false; }
  };
  return <Modal title="管理者権限での実行を確認" busy={busy} onClose={onClose} className="approval-dialog">
    <form className="approval-form" onSubmit={e => { e.preventDefault(); void perform(true); }}>
      <p className="field-hint">端末から次のコマンドの実行が要求されています。</p>
      <pre className="approval-command">{pending.cmd}</pre>
      <p className="approval-directory">{pending.cwd}</p>
      {pending.detail && <details><summary>スクリプトの内容</summary><pre className="approval-detail">{pending.detail}</pre></details>}
      {pending.attempt > 1 && <p className="inline-error">パスワードを確認して、もう一度入力してください（{pending.attempt}回目）。</p>}
      {!secure && <p className="inline-error" role="alert">承認するにはHTTPSのURLで接続してください。</p>}
      {left === 0 ? <p className="inline-error" role="alert">期限が切れました。端末からもう一度実行してください。</p> : <label className="project-field">このPCのパスワード<input ref={field} type="password" autoComplete="off" disabled={!secure || busy} onChange={e => setHasPassword(Boolean(e.target.value))} /></label>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <footer className="app-modal-actions"><span className="field-hint">残り {left} 秒</span><button type="button" className="btn" disabled={busy} onClick={() => void perform(false)}>拒否する</button><button type="submit" className="btn primary" disabled={!ready || !secure || !hasPassword || busy || left === 0}>{busy ? '送信中…' : '承認して実行'}</button></footer>
    </form>
  </Modal>;
}
