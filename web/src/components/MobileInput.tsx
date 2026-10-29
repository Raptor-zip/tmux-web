import { useRef, useState } from 'react';
import { Icon } from './Icon';
import type { AttachmentResult } from '../attachments';

interface Props {
  connected: boolean;
  onPaste(text: string): boolean | undefined;
  onSend(data: string): void;
  /** 添付の入力結果と、下書きに回収するパスを返す。 */
  onAttach(files: File[]): Promise<AttachmentResult>;
}

/** 通常の textarea に変換・選択・長押し貼り付けを任せ、確定後だけ端末へ渡す。 */
export function MobileInput({ connected, onPaste, onSend, onAttach }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [attaching, setAttaching] = useState(false);
  const attachLock = useRef(false);
  const attach = async (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (!files.length || attachLock.current) return;
    attachLock.current = true;
    setAttaching(true);
    try {
      const result = await onAttach(files);
      if (!result.inserted) {
        if (result.text) setText(old => old + (old && !/\s$/.test(old) ? ' ' : '') + result.text);
        setExpanded(true);
      }
      setMessage(result.error || (result.inserted ? '' : '端末が切り替わったか切断されたため、添付パスを下書きに残しました。'));
    }
    catch (err) { setMessage((err as Error).message); setExpanded(true); }
    finally { attachLock.current = false; setAttaching(false); if (picker.current) picker.current.value = ''; }
  };
  const insert = () => {
    if (!connected || composing || !text) return;
    if (!onPaste(text)) { setMessage('端末に再接続してから挿入してください。下書きは残っています。'); return; }
    setText('');
    setMessage('');
    input.current?.focus();
  };
  return (
    <div className="mobile-input">
      <div className="mobile-input-toggle-row"><button className="input-toggle" aria-expanded={expanded} onClick={()=>{if (expanded) { input.current?.blur(); setComposing(false); } setExpanded(v=>!v); if (!expanded) requestAnimationFrame(()=>input.current?.focus());}}><Icon name="keyboard" />{expanded ? '入力欄を閉じる' : text ? '下書きを開く' : '文字入力・貼り付け'}</button><button className="input-attach" disabled={!connected || attaching} onClick={()=>picker.current?.click()}><Icon name="plus" />{attaching ? '送信中…' : '添付'}</button><input ref={picker} type="file" multiple hidden onChange={(e)=>void attach(e.target.files)} /><button className="input-enter" disabled={!connected || composing} onClick={()=>onSend('\r')}>Enter ↵</button></div>
      <div className="mobile-input-draft" hidden={!expanded}>
      <textarea
        ref={input}
        aria-label="文字入力・貼り付け用の下書き"
        placeholder="ここで文字入力・長押し貼り付け"
        value={text}
        rows={2}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
      />
      <div className="mobile-input-actions">
        <button type="button" className="key" disabled={composing} onClick={async () => {
          try {
            const value = await navigator.clipboard.readText();
            const el = input.current;
            const start = el?.selectionStart ?? text.length;
            const end = el?.selectionEnd ?? start;
            setText((old) => old.slice(0, start) + value + old.slice(end));
            setMessage('');
          } catch {
            setMessage('入力欄を長押しして「貼り付け」を選んでください');
          }
          input.current?.focus();
        }}>貼り付け</button>
        <button type="button" className="key" disabled={!connected || composing || !text} onClick={insert}>端末に挿入</button>
        <button type="button" className="key" disabled={!connected || composing} onClick={() => onSend('\r')}>Enter</button>
      </div>
      </div>
      {expanded && message && <div className="mobile-input-hint" role="status">{message}</div>}
    </div>
  );
}
