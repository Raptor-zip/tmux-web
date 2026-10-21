import { useEffect, useRef, useState } from 'react';
import { TOKEN } from '../api';

const managerUrl = '/projects/' + (TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : '');

/** Keep terminal tabs mounted while managing projects and approving sudo requests. */
export function ProjectManager({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="project-manager" aria-labelledby="project-manager-title"
    onCancel={onClose}>
    <header><strong id="project-manager-title">プロジェクト管理</strong>
      <button autoFocus onClick={onClose}>端末に戻る</button></header>
    <iframe title="プロジェクト・Claude履歴・ファイル・sudo承認" src={managerUrl} />
  </dialog>;
}

export function SudoNotice({ onOpen }: { onOpen(): void }) {
  const [command, setCommand] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch('/projects/api/askpass/pending', {
          headers: TOKEN ? { 'x-tmux-web-token': TOKEN } : {},
          signal: controller.signal, cache: 'no-store',
        });
        if (res.ok) setCommand((await res.json()).pending?.cmd ?? null);
        else setCommand(null);
      } catch { /* retry on reconnect */ }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  return command === null ? null : <button className="sudo-notice" onClick={onOpen}>
    sudo の承認待ち：{command} — 開いて確認
  </button>;
}
