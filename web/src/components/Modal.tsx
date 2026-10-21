import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

/** Shared app surface: native focus containment, Escape dismissal, and focus restoration. */
export function Modal({ title, onClose, busy = false, children, className = '' }: {
  title: string; onClose(): void; busy?: boolean; children: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.showModal();
    return () => { node?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={`app-modal ${className}`} aria-label={title}
    onKeyDown={e => e.stopPropagation()} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}
    onClick={e => { if (!busy && e.target === e.currentTarget) { const box = e.currentTarget.getBoundingClientRect(); if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose(); } }}>
    <header className="app-modal-head"><h2>{title}</h2><button className="icon-btn" aria-label="閉じる" disabled={busy} onClick={onClose}><Icon name="close" /></button></header>
    {children}
  </dialog>;
}
