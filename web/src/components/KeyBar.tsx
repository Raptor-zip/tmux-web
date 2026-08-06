interface Props {
  onSend(data: string): void;
  prefix: string;
}

/** tmux の prefix 表記 (C-b, C-a …) を実際の制御文字に変換する */
function prefixToBytes(prefix: string): string {
  const m = prefix.match(/^C-([a-z])$/i);
  if (m) return String.fromCharCode(m[1].toLowerCase().charCodeAt(0) - 96);
  return '\x02'; // 既定は C-b
}

const KEYS: { label: string; data: string; title?: string; wide?: boolean }[] = [
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: '^C', data: '\x03', title: '中断 (Ctrl+C)' },
  { label: '^D', data: '\x04', title: '終了 / EOF (Ctrl+D)' },
  { label: '^Z', data: '\x1a', title: 'サスペンド (Ctrl+Z)' },
  { label: '^L', data: '\x0c', title: '画面クリア (Ctrl+L)' },
  { label: '^R', data: '\x12', title: '履歴検索 (Ctrl+R)' },
  { label: '←', data: '\x1b[D' },
  { label: '↓', data: '\x1b[B' },
  { label: '↑', data: '\x1b[A' },
  { label: '→', data: '\x1b[C' },
  { label: 'Home', data: '\x1b[H' },
  { label: 'End', data: '\x1b[F' },
  { label: 'PgUp', data: '\x1b[5~' },
  { label: 'PgDn', data: '\x1b[6~' },
];

export function KeyBar({ onSend, prefix }: Props) {
  return (
    <div className="keybar">
      <button
        className="key prefix"
        title={`tmux prefix (${prefix}) を送る。素の tmux キー操作をしたいとき用。`}
        onClick={() => onSend(prefixToBytes(prefix))}
      >
        {prefix}
      </button>
      <span className="key-sep" />
      {KEYS.map((k) => (
        <button key={k.label} className="key" title={k.title ?? k.label} onClick={() => onSend(k.data)}>
          {k.label}
        </button>
      ))}
    </div>
  );
}
