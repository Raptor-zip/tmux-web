import { useRef, useState } from 'react';
import { Icon } from './Icon';

interface Props {
  connected: boolean;
  onPaste(text: string): void;
  onSend(data: string): void;
}

/** 通常の textarea に変換・選択・長押し貼り付けを任せ、確定後だけ端末へ渡す。 */
export function MobileInput({ connected, onPaste, onSend }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const insert = () => {
    if (!connected || composing || !text) return;
    onPaste(text);
    setText('');
    input.current?.focus();
  };
  return (
    <div className="mobile-input">
      <div className="mobile-input-toggle-row"><button className="input-toggle" aria-expanded={expanded} onClick={()=>{if (expanded) { input.current?.blur(); setComposing(false); } setExpanded(v=>!v); if (!expanded) requestAnimationFrame(()=>input.current?.focus());}}><Icon name="keyboard" />{expanded ? '入力欄を閉じる' : text ? '下書きを開く' : '文字入力・貼り付け'}</button><button className="input-enter" disabled={!connected || composing} onClick={()=>onSend('\r')}>Enter ↵</button></div>
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
