import { useRef, useState } from 'react';

interface Props {
  connected: boolean;
  onPaste(text: string): void;
  onSend(data: string): void;
}

/** 通常の textarea に変換・選択・長押し貼り付けを任せ、確定後だけ端末へ渡す。 */
export function MobileInput({ connected, onPaste, onSend }: Props) {
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
      <textarea
        ref={input}
        aria-label="日本語入力・貼り付け用の下書き"
        placeholder="ここで日本語入力・長押し貼り付け"
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
      {message && <div className="mobile-input-hint" role="status">{message}</div>}
    </div>
  );
}
