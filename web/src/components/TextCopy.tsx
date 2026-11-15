import { useEffect, useRef, useState } from 'react';
import { fetchCapture } from '../api';
import type { Pane } from '../types';
import { Modal } from './Modal';

/**
 * 『テキストを選んでコピー…』のシート。
 *
 * 端末（xterm）の上では、タッチで文字を選べない（tmux がマウスを使っていると選択が tmux に取られ、
 * スマホでは長押しがメニューになる）。そこで、ペインの全文（履歴込み）をふつうの文字として出し、
 * ブラウザの選択でそのまま範囲を選べるようにする。
 */
export function TextCopy({ pane, onClose, onCopied, onError }: {
  pane: Pane;
  onClose(): void;
  onCopied(lines: number): void;
  onError(text: string): void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pre = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let alive = true;
    fetchCapture(pane.id, 5000, true)
      .then(({ text }) => { if (alive) setText(text.replace(/\s+$/, '')); })
      .catch(err => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [pane.id]);

  // 最新の行が見えるよう、読み込んだら末尾まで送る
  useEffect(() => {
    const el = pre.current;
    if (el && text !== null) el.scrollTop = el.scrollHeight;
  }, [text]);

  /** シートの中で選んだ文字。シートの外の選択は使わない */
  const selected = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !pre.current) return '';
    const range = selection.getRangeAt(0);
    return pre.current.contains(range.commonAncestorContainer) ? selection.toString() : '';
  };

  const copy = async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      onCopied(value.split('\n').length);
      onClose();
    } catch (err) {
      onError(`コピーに失敗: ${(err as Error).message}`);
    }
  };

  return (
    <Modal title="テキストを選んでコピー" className="text-copy-modal" onClose={onClose}>
      <p className="text-copy-note">ペイン {pane.index} の全文（履歴込み）です。指やマウスで範囲を選んでから［選択をコピー］を押してください。</p>
      {error ? <p className="text-copy-error" role="alert">読み込めませんでした: {error}</p>
        : text === null ? <p className="text-copy-note" role="status">読み込み中…</p>
        : <pre ref={pre} className="text-copy-text" tabIndex={0} aria-label="ペインの全文">{text}</pre>}
      <div className="app-modal-actions text-copy-actions">
        <button className="btn" disabled={!text} onClick={() => copy(text ?? '')}>全文をコピー</button>
        <button className="btn primary" disabled={!text} onClick={() => {
          const value = selected();
          if (value) copy(value);
          else onError('先に範囲を選んでください');
        }}>選択をコピー</button>
      </div>
    </Modal>
  );
}
