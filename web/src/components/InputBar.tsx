import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ContextMenu, SEP, type MenuEntry } from './ContextMenu';
import type { AttachmentResult } from '../attachments';

interface Props {
  /** 入力先の端末が入力を受け付けられる（接続済みで、選んだ端末への切り替えが終わっている） */
  connected: boolean;
  /** 入力先の端末でエージェントが入力待ち。回答キー（1 2 3 y n）を強調する */
  waiting?: boolean;
  /** 『入力行：常に表示』。マウスの広い画面でも出す */
  always?: boolean;
  /** tmux の prefix 表記（C-b など）。キー⋯ から送る */
  prefix: string;
  /** 下書きを端末へ貼り付ける（bracketed paste）。入力先が受け付けなければ false */
  onPaste(text: string): boolean | undefined;
  onSend(data: string): void;
  /** 添付の入力結果と、下書きに回収するパスを返す。 */
  onAttach(files: File[]): Promise<AttachmentResult>;
}

interface Key { label: string; data: string; name?: string; answer?: boolean }

/** キー列。位置で覚えられるよう、順番は固定する */
const KEYS: Key[] = [
  { label: 'Esc', data: '\x1b' },
  { label: '↑', data: '\x1b[A', name: '上' },
  { label: '↓', data: '\x1b[B', name: '下' },
  { label: 'Tab', data: '\t' },
  { label: '^C', data: '\x03', name: 'Ctrl+C（中断）' },
  { label: '⇧Tab', data: '\x1b[Z', name: 'Shift+Tab' },
  { label: '←', data: '\x1b[D', name: '左' },
  { label: '→', data: '\x1b[C', name: '右' },
  { label: '1', data: '1', answer: true },
  { label: '2', data: '2', answer: true },
  { label: '3', data: '3', answer: true },
  { label: 'y', data: 'y', answer: true },
  { label: 'n', data: 'n', answer: true },
];

/** tmux の prefix 表記 (C-b, C-a …) を実際の制御文字に変換する */
export function prefixToBytes(prefix: string): string {
  const m = prefix.match(/^C-([a-z])$/i);
  if (m) return String.fromCharCode(m[1].toLowerCase().charCodeAt(0) - 96);
  return '\x02'; // 既定は C-b
}

/** キー⋯ の中身。使う頻度の低いキーを、キー列の幅を取らずに出す */
function moreKeys(prefix: string, send: (data: string) => void): MenuEntry[] {
  const item = (label: string, data: string, hint?: string) => ({ label, hint, run: () => send(data) });
  return [
    item('^D', '\x04', 'EOF・終了'),
    item('^Z', '\x1a', 'サスペンド'),
    item('^L', '\x0c', '画面クリア'),
    item('^R', '\x12', '履歴検索'),
    SEP,
    item('Home', '\x1b[H'),
    item('End', '\x1b[F'),
    item('PgUp', '\x1b[5~'),
    item('PgDn', '\x1b[6~'),
    item('⌫', '\x7f', 'Backspace'),
    SEP,
    item(`tmux prefix（${prefix}）`, prefixToBytes(prefix)),
  ];
}

/** 下書き欄の高さ：2〜6 行で中身に合わせて伸ばす */
const DRAFT_MAX_LINES = 6;

/**
 * 入力行。キー列（横スクロール）と、右端に固定した［入力］［↵］。
 * ［入力］で上に下書き欄を開き、変換・選択・長押し貼り付けはスマホ標準の入力欄に任せる。
 */
export function InputBar({ connected, waiting, always, prefix, onPaste, onSend, onAttach }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState('');
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const keys = useRef<HTMLDivElement>(null);
  const [attaching, setAttaching] = useState(false);
  const attachLock = useRef(false);

  // 入力待ちになったら、強調した回答キーが見えるようにキー列を寄せる（狭い画面では右側に隠れているため）
  useEffect(() => {
    const row = keys.current;
    if (!waiting || !row) return;
    const answers = row.querySelectorAll<HTMLElement>('.key.answer');
    const first = answers[0], last = answers[answers.length - 1];
    if (!first || !last) return;
    const box = row.getBoundingClientRect();
    const left = first.getBoundingClientRect().left - box.left + row.scrollLeft;
    const right = last.getBoundingClientRect().right - box.left + row.scrollLeft;
    if (left >= row.scrollLeft && right <= row.scrollLeft + row.clientWidth) return;
    row.scrollTo({ left: Math.max(0, right - row.clientWidth + 4), behavior: 'smooth' });
  }, [waiting]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el || !expanded) return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 22;
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const max = line * DRAFT_MAX_LINES + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + border;
    el.style.height = `${Math.min(el.scrollHeight + border, max)}px`;
  }, [text, expanded]);

  const open = () => {
    setExpanded(true);
    requestAnimationFrame(() => input.current?.focus());
  };
  const close = () => {
    input.current?.blur();
    setComposing(false);
    setExpanded(false);
    setMessage('');
  };

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

  /** 下書きを端末へ貼り付ける。submit なら続けて Enter（\r）も送る */
  const deliver = (submit: boolean) => {
    if (!connected || composing || !text) return;
    if (!onPaste(text)) { setMessage('端末に再接続してから送ってください。下書きは残っています。'); return; }
    if (submit) onSend('\r');
    setText('');
    setMessage('');
    input.current?.focus();
  };

  const pasteClipboard = async () => {
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
  };

  /** キーを押しても、端末やスマホのキーボードからフォーカスを奪わない */
  const keep = (e: React.PointerEvent) => e.preventDefault();

  return (
    <div className={`input-bar${always ? ' input-always' : ''}`}>
      <input ref={picker} type="file" multiple hidden onChange={(e) => void attach(e.target.files)} />
      {expanded && (
        <div className="input-draft">
          <textarea
            ref={input}
            aria-label="下書き"
            placeholder="ここで文字入力・長押し貼り付け"
            value={text}
            rows={2}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !composing) { e.preventDefault(); close(); toggle.current?.focus(); }
            }}
          />
          <div className="input-draft-actions">
            <button type="button" disabled={composing} onClick={() => void pasteClipboard()}>貼り付け</button>
            <button type="button" className="input-attach" disabled={!connected || attaching} onClick={() => picker.current?.click()}>
              {attaching ? '送信中…' : '添付'}
            </button>
            <button type="button" disabled={!connected || composing || !text} onClick={() => deliver(false)}>挿入のみ</button>
            <button type="button" className="input-submit" disabled={!connected || composing || !text} onClick={() => deliver(true)}>送信 ↵</button>
          </div>
          {message && <div className="input-hint" role="status">{message}</div>}
        </div>
      )}
      <div className="input-row">
        <div ref={keys} className={`input-keys${waiting ? ' waiting' : ''}`} role="group" aria-label="キー">
          {KEYS.map((k) => (
            <button
              key={k.label}
              type="button"
              className={`key${k.answer ? ' answer' : ''}`}
              aria-label={k.name}
              title={k.name ?? k.label}
              disabled={!connected}
              onPointerDown={keep}
              onClick={() => onSend(k.data)}
            >
              {k.label}
            </button>
          ))}
          <button
            type="button"
            className="key more"
            aria-haspopup="menu"
            aria-expanded={!!more}
            disabled={!connected}
            onPointerDown={keep}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMore({ x: r.left, y: r.top });
            }}
          >
            キー⋯
          </button>
        </div>
        <button
          ref={toggle}
          type="button"
          className={`input-toggle${text ? ' has-draft' : ''}`}
          aria-expanded={expanded}
          title={text && !expanded ? '入力（下書きあり）' : '入力'}
          onClick={() => (expanded ? close() : open())}
        >
          入力{text && !expanded && <span className="input-draft-mark" aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="input-enter"
          aria-label="Enter"
          title="Enter"
          disabled={!connected || composing}
          onPointerDown={keep}
          onClick={() => onSend('\r')}
        >
          ↵
        </button>
      </div>
      {more && <ContextMenu x={more.x} y={more.y} title="キー" items={moreKeys(prefix, onSend)} onClose={() => setMore(null)} />}
    </div>
  );
}

/** 画面タブの入力行のキー（X11 の keysym と、KeyboardEvent.code） */
const SCREEN_KEYS: { label: string; keysym: number; code: string; name?: string }[] = [
  { label: 'Esc', keysym: 0xff1b, code: 'Escape' },
  { label: 'Tab', keysym: 0xff09, code: 'Tab' },
  { label: '↑', keysym: 0xff52, code: 'ArrowUp', name: '上' },
  { label: '↓', keysym: 0xff54, code: 'ArrowDown', name: '下' },
  { label: '←', keysym: 0xff51, code: 'ArrowLeft', name: '左' },
  { label: '→', keysym: 0xff53, code: 'ArrowRight', name: '右' },
  { label: 'Enter', keysym: 0xff0d, code: 'Enter' },
];

/**
 * 画面タブ（リモートデスクトップ）の入力行。Esc Tab ↑ ↓ ← → Enter と、押したままにできる Ctrl・Alt、
 * 右端に［⌨ 文字入力］。Ctrl・Alt は次に押したキーと一緒に送り、送ったら離す（押したまま残さない）。
 */
export function ScreenInputBar({ connected, always, onKey, onText }: {
  /** 画面に接続している */
  connected: boolean;
  always?: boolean;
  onKey(keysym: number, code: string, mods: { ctrl: boolean; alt: boolean }): void;
  onText(): void;
}) {
  const [mods, setMods] = useState({ ctrl: false, alt: false });
  // 切断したら押したままの印を消す
  useEffect(() => { if (!connected) setMods({ ctrl: false, alt: false }); }, [connected]);
  const keep = (e: React.PointerEvent) => e.preventDefault();
  const held = [mods.ctrl && 'Ctrl', mods.alt && 'Alt'].filter(Boolean).join('+');
  return (
    <div className={`input-bar screen-input-bar${always ? ' input-always' : ''}`}>
      <div className="input-row">
        <div className="input-keys" role="group" aria-label="画面へ送るキー">
          {SCREEN_KEYS.map(k => (
            <button
              key={k.label}
              type="button"
              className="key"
              aria-label={held ? `${held}+${k.name ?? k.label}` : k.name}
              title={held ? `${held}+${k.name ?? k.label}` : k.name ?? k.label}
              disabled={!connected}
              onPointerDown={keep}
              onClick={() => { onKey(k.keysym, k.code, mods); setMods({ ctrl: false, alt: false }); }}
            >
              {k.label}
            </button>
          ))}
          {(['ctrl', 'alt'] as const).map(m => (
            <button
              key={m}
              type="button"
              className="key modifier"
              aria-pressed={mods[m]}
              title={`${m === 'ctrl' ? 'Ctrl' : 'Alt'} を押したままにする（次のキーと一緒に送る）`}
              disabled={!connected}
              onPointerDown={keep}
              onClick={() => setMods(v => ({ ...v, [m]: !v[m] }))}
            >
              {m === 'ctrl' ? 'Ctrl' : 'Alt'}
            </button>
          ))}
        </div>
        <button type="button" className="input-toggle screen-text" aria-label="文字入力" title="文字入力" onClick={onText}>
          ⌨ 文字入力
        </button>
      </div>
    </div>
  );
}
