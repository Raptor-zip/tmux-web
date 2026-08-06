import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { CanvasAddon } from '@xterm/addon-canvas';
import '@xterm/xterm/css/xterm.css';
import { wsUrl } from '../api';

const THEME = {
  background: '#0d1117',
  foreground: '#d5dae2',
  cursor: '#6ee7ff',
  cursorAccent: '#0d1117',
  selectionBackground: '#2b4a6f',
  black: '#1c2128',
  red: '#ff7b72',
  green: '#7ee787',
  yellow: '#e3b341',
  blue: '#79c0ff',
  magenta: '#d2a8ff',
  cyan: '#6ee7ff',
  white: '#c9d1d9',
  brightBlack: '#57606a',
  brightRed: '#ffa198',
  brightGreen: '#a5f3b0',
  brightYellow: '#f2cc60',
  brightBlue: '#a5d6ff',
  brightMagenta: '#e2c5ff',
  brightCyan: '#9df0ff',
  brightWhite: '#f0f6fc',
};

export interface TerminalHandle {
  /** ミラーセッション側で表示ウィンドウを切り替える */
  selectWindow(index: number): void;
  /** 生のキー列を tmux に送る（ツールバー用） */
  send(data: string): void;
  focus(): void;
  fit(): void;
}

interface Props {
  sessionId: string | null;
  windowId: string | null;
  /** 表示したいウィンドウの番号。ミラーセッション側だけを切り替える */
  windowIndex: number | null;
  mode: 'mirror' | 'direct';
  showStatusBar: boolean;
  fontSize: number;
  onStatus?: (s: { connected: boolean; message?: string }) => void;
}

export const TerminalView = forwardRef<TerminalHandle, Props>(function TerminalView(
  { sessionId, windowId, windowIndex, mode, showStatusBar, fontSize, onStatus },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const rafRef = useRef(0);

  /**
   * fit() は次のフレームにまとめ、実際にサイズが変わるときだけ呼ぶ。
   * こうしないと ResizeObserver と描画が延々と互いを呼び合ってタブが固まる。
   */
  const safeFitRef = useRef(() => {});
  safeFitRef.current = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const term = termRef.current;
      const fit = fitRef.current;
      if (!term || !fit) return;
      try {
        const dims = fit.proposeDimensions();
        if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return;
        if (dims.cols < 2 || dims.rows < 2) return;
        if (dims.cols === term.cols && dims.rows === term.rows) return;
        term.resize(dims.cols, dims.rows);
      } catch {
        /* 非表示のときは測定できないので何もしない */
      }
    });
  };
  // 接続完了時に「今どのウィンドウを見たいか」を参照するための最新値
  const windowIndexRef = useRef<number | null>(windowIndex);
  windowIndexRef.current = windowIndex;

  useImperativeHandle(ref, () => ({
    selectWindow(index: number) {
      wsRef.current?.readyState === WebSocket.OPEN &&
        wsRef.current.send(JSON.stringify({ type: 'selectWindow', index }));
    },
    send(data: string) {
      wsRef.current?.readyState === WebSocket.OPEN &&
        wsRef.current.send(JSON.stringify({ type: 'input', data }));
      termRef.current?.focus();
    },
    focus() {
      termRef.current?.focus();
    },
    fit() {
      safeFitRef.current();
    },
  }));

  // xterm 本体は一度だけ作る
  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      fontFamily:
        '"JetBrains Mono", "Fira Code", "Cascadia Code", "Noto Sans Mono CJK JP", "Menlo", monospace',
      fontSize,
      lineHeight: 1.15,
      letterSpacing: 0,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 0, // スクロールバックは tmux 側が持つ
      theme: THEME,
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    const uni = new Unicode11Addon();
    term.loadAddon(uni);
    term.unicode.activeVersion = '11';
    term.open(innerRef.current!);
    // canvas レンダラ。WebGL はドライバ依存で描画が固まることがあるので使わない。
    try {
      term.loadAddon(new CanvasAddon());
    } catch {
      /* 使えない環境では DOM レンダラのまま動く */
    }
    termRef.current = term;
    fitRef.current = fit;
    safeFitRef.current();

    // ResizeObserver が監視するのは外側の枠だけにする。
    // xterm が描画する内側を監視すると fit() → DOM 変化 → fit() の無限ループになる。
    const ro = new ResizeObserver(() => safeFitRef.current());
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.fontSize = fontSize;
      safeFitRef.current();
    }
  }, [fontSize]);

  // 接続（セッション・モードが変わったら張り直す）
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit || !sessionId) return;

    term.reset();
    onStatus?.({ connected: false, message: '接続中…' });

    let disposed = false;
    let ws: WebSocket | null = null;
    const disposables: { dispose(): void }[] = [];

    const start = () => {
      try {
        const dims = fit.proposeDimensions();
        if (dims && dims.cols > 1 && dims.rows > 1) term.resize(dims.cols, dims.rows);
      } catch {
        /* ignore */
      }
      const cols = term.cols;
      const rows = term.rows;
      ws = new WebSocket(
        wsUrl('/ws/terminal', {
          session: sessionId,
          ...(windowId ? { window: windowId } : {}),
          cols,
          rows,
          mode,
          status: showStatusBar ? 1 : 0,
        }),
      );
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        onStatus?.({ connected: true });
        // 接続直後に、UI が選んでいるウィンドウへ合わせる
        if (windowIndexRef.current != null) {
          ws?.send(JSON.stringify({ type: 'selectWindow', index: windowIndexRef.current }));
        }
      };
      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(ev.data));
          return;
        }
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'error') {
            onStatus?.({ connected: false, message: msg.message });
            term.writeln(`\r\n\x1b[31m接続エラー: ${msg.message}\x1b[0m`);
          } else if (msg.type === 'exit') {
            onStatus?.({ connected: false, message: 'デタッチしました' });
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (!disposed) onStatus?.({ connected: false, message: '切断されました' });
      };

      disposables.push(
        term.onData((data) => {
          ws?.readyState === WebSocket.OPEN &&
            ws.send(JSON.stringify({ type: 'input', data }));
        }),
      );
      disposables.push(
        term.onResize(({ cols: c, rows: r }) => {
          ws?.readyState === WebSocket.OPEN &&
            ws.send(JSON.stringify({ type: 'resize', cols: c, rows: r }));
        }),
      );
    };

    const timer = setTimeout(start, 30);

    return () => {
      disposed = true;
      clearTimeout(timer);
      disposables.forEach((d) => d.dispose());
      ws?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, mode, showStatusBar]);

  // 同じセッション内のウィンドウ切り替えは、再接続せずミラー側の表示だけ変える
  useEffect(() => {
    if (windowIndex == null) return;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'selectWindow', index: windowIndex }));
    }
  }, [windowIndex, windowId]);

  return (
    <div className="terminal-host" ref={hostRef}>
      <div className="terminal-inner" ref={innerRef} />
    </div>
  );
});
