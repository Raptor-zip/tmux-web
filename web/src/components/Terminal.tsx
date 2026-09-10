import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { CanvasAddon } from '@xterm/addon-canvas';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import '@xterm/xterm/css/xterm.css';
import { wsUrl } from '../api';

// VS Code の既定のダークテーマ（Dark+）の端末色に合わせている
const THEME = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#aeafad',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
};

export interface TerminalHandle {
  /** ミラーセッション側で表示ウィンドウを切り替える */
  selectWindow(index: number): void;
  /** 生のキー列を tmux に送る（ツールバー用） */
  send(data: string): void;
  focus(): void;
  fit(): void;
  /** xterm 側で選択されている文字列（tmux の選択はここには出ない） */
  getSelection(): string;
  clearSelection(): void;
}

interface Props {
  sessionId: string | null;
  windowId: string | null;
  /** 表示したいウィンドウの番号。ミラーセッション側だけを切り替える */
  windowIndex: number | null;
  mode: 'mirror' | 'direct';
  showStatusBar: boolean;
  fontSize: number;
  lineHeight: number;
  /** 端末の上で右クリックされた。アプリ側のメニューを出す */
  onContextMenu?: (x: number, y: number) => void;
  onStatus?: (s: { connected: boolean; message?: string }) => void;
  /** クリップボードに入ったことを知らせる（選択したのに入っていないと分からないため） */
  onCopied?: (text: string) => void;
}

export const TerminalView = forwardRef<TerminalHandle, Props>(function TerminalView(
  {
    sessionId,
    windowId,
    windowIndex,
    mode,
    showStatusBar,
    fontSize,
    lineHeight: rawLineHeight,
    onContextMenu,
    onStatus,
    onCopied,
  },
  ref,
) {
  /**
   * xterm は lineHeight < 1 を例外で弾く。保存値が古かったり壊れていたりしても
   * 画面ごと落ちないよう、渡す手前で必ず有効な範囲に収める。
   */
  const lineHeight = Number.isFinite(rawLineHeight)
    ? Math.min(2, Math.max(1, rawLineHeight))
    : 1;
  const hostRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const rafRef = useRef(0);

  /** tmux への入力はここだけを通す。空文字は送らない（IME 確定後の空振りを弾く） */
  const sendInputRef = useRef((data: string) => {
    const s = wsRef.current;
    if (data && s?.readyState === WebSocket.OPEN) {
      s.send(JSON.stringify({ type: 'input', data }));
    }
  });

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
  // 端末は一度だけ組み立てるので、最新のハンドラは ref 経由で見る
  const onContextMenuRef = useRef(onContextMenu);
  onContextMenuRef.current = onContextMenu;
  const onCopiedRef = useRef(onCopied);
  onCopiedRef.current = onCopied;

  useImperativeHandle(ref, () => ({
    selectWindow(index: number) {
      wsRef.current?.readyState === WebSocket.OPEN &&
        wsRef.current.send(JSON.stringify({ type: 'selectWindow', index }));
    },
    send(data: string) {
      sendInputRef.current(data);
      termRef.current?.focus();
    },
    focus() {
      termRef.current?.focus();
    },
    fit() {
      safeFitRef.current();
    },
    getSelection() {
      return termRef.current?.getSelection() ?? '';
    },
    clearSelection() {
      termRef.current?.clearSelection();
    },
  }));

  // xterm 本体は一度だけ作る
  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      fontFamily:
        '"JetBrains Mono", "Fira Code", "Cascadia Code", "Noto Sans Mono CJK JP", "Menlo", monospace',
      fontSize,
      lineHeight,
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
    /**
     * OSC 52 を受け取ってブラウザのクリップボードに入れる。
     * tmux 側でマウス選択してコピーしたとき（copy-selection）、tmux は
     * set-clipboard on なら OSC 52 でクライアント端末に渡してくる。それが
     * ここに届く。これが無いと「選択したのにブラウザには何も入らない」になる。
     */
    term.loadAddon(new ClipboardAddon());
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

    /**
     * 右クリックはアプリ側のメニューに回す。
     *
     * tmux の display-menu に任せると、マウス報告が届くかどうか・コピーモード中か
     * どうかで出たり出なかったりする。ブラウザ側で出せばどの状況でも同じに使える。
     * そのため右ボタンは tmux に送らない（capture 段階で xterm より先に止める）。
     * ブラウザ本来のメニューが要るときは Shift を押しながら右クリック。
     */
    const host = hostRef.current;

    /**
     * 選択したらそのままクリップボードに入れる（tmux のマウス選択と同じ感覚にする）。
     *
     * xterm 側の選択が起きるのは、tmux にマウス報告が渡らない場面
     * （Shift を押しながらのドラッグ、mouse off のペイン、コピーモードでない画面）。
     * ボタンを離した時点だけを見る。onSelectionChange はドラッグ中に何度も鳴るので、
     * そのたびに書き込むとクリップボードが途中経過で埋まる。
     */
    const copySelection = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const text = termRef.current?.getSelection() ?? '';
      if (!text.trim()) return;
      navigator.clipboard
        ?.writeText(text)
        .then(() => onCopiedRef.current?.(text))
        .catch(() => {
          /* 権限が無い / HTTP で開いている場合は諦める。選択自体は残る */
        });
    };

    /**
     * Ctrl+Shift+C は端末の慣習どおりコピーに使う（Ctrl+C は SIGINT のまま送る）。
     * 選択が無いときは何もせず、キーはそのまま tmux へ流す。
     */
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const copyKey = e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c');
      if (!copyKey || !term.hasSelection()) return true;
      const text = term.getSelection();
      navigator.clipboard
        ?.writeText(text)
        .then(() => onCopiedRef.current?.(text))
        .catch(() => {});
      return false;
    });

    const swallowRightButton = (e: MouseEvent) => {
      if (e.button !== 2 || e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onContextMenu = (e: MouseEvent) => {
      if (e.shiftKey) return; // ブラウザのメニューへの逃げ道
      e.preventDefault();
      e.stopPropagation();
      onContextMenuRef.current?.(e.clientX, e.clientY);
    };

    /**
     * 日本語入力（IME）の確定文字は、xterm ではなくここで送る。
     *
     * xterm には確定文字を送る経路が 3 つあり、どれが動くかはイベントが届く順で
     * 変わる。IME が絡むと同じ文字が 2 回、3 回と送られる。
     *
     * 1. CompositionHelper._finalizeComposition
     *    補助 textarea の `value.substring(start, end)` を切り出して送る。`start` は
     *    変換開始時に同期で決まるのに、`end` は compositionupdate の `setTimeout(0)`
     *    で遅れて更新される。変換で文字数が変わる（「おは」→「おはようございます」）と
     *    `end` が古いまま残り、次の変換では `start > end` になる。JS の `substring` は
     *    start > end だと**引数を入れ替える**ので、ひとつ前に入力した文章の断片が出る。
     * 2. CompositionHelper._handleAnyTextareaChanges
     *    IME が有効なときのキーは keyCode 229 で届く。xterm はそこで textarea の値を
     *    覚えておき、`setTimeout(0)` のあとに増えていたぶんを送る。「？」「、」のように
     *    IME が変換を挟まず即確定する文字がここを通る。
     * 3. Terminal._inputEvent
     *    input イベントの `data` をそのまま送る。keyup が input より先に来たときだけ
     *    通る（`_keyDownSeen` の判定）ので、出たり出なかったりする。
     *
     * 2 と 3 は同じ文字を二重に送りうるし、こちらが compositionend で送ればさらに
     * 増える。「？」や「、」が 2 つ 3 つ並ぶのはこれ。そこで IME が絡む入力はすべて
     * こちらで引き受け、xterm には渡さない。確定文字は compositionend の `data`
     * （IME が確定した文字そのもの）から送り、そのあと textarea に書き戻された同じ
     * 文字は捨てる。補助 textarea は常に空にしておき、2 の差分検出を空振りさせる。
     *
     * IME が絡まない入力（絵文字パレットなど）は今までどおり xterm に任せる。
     * `data` を出さない環境の compositionend も同じく xterm の経路に戻す。
     */
    const clearHelper = () => {
      if (term.textarea) term.textarea.value = '';
    };

    /** 変換中か。途中経過の textarea は IME のものなので触らない */
    let composing = false;
    /** 直前の keydown が IME のものだったか（IME が有効なキーは keyCode 229 で届く） */
    let imeKey = false;
    /** compositionend で送った確定文字。同じものが input で戻ってきたら捨てる */
    let sent: { data: string; at: number } | null = null;

    const onKeyDown = (e: Event) => {
      const ev = e as KeyboardEvent;
      imeKey = ev.keyCode === 229 || ev.isComposing;
      // compositionend のあとに input が来ないブラウザでは sent が残る。そのまま
      // 通常キーへ移ると、xterm が keydown で送った文字を onInput でも送り直して
      // 最初の英字・記号だけ二重になる。非 IME の keydown は新しい入力の開始なので、
      // 直前の確定文字を捨てるためだけの印はここで失効させる。
      if (!imeKey) sent = null;
      // xterm はこの keydown の時点の textarea を覚えておき、あとで増減を見て
      // 差分（減っていれば DEL）を送る。変換中でなければ空が正しい状態なので、
      // 書き戻しの取りこぼしが残っていてもここで必ず空に揃える。
      if (imeKey && !composing) clearHelper();
    };
    const onCompositionStart = () => {
      composing = true;
      sent = null;
      clearHelper();
    };
    const onCompositionEnd = (e: Event) => {
      composing = false;
      const data = (e as CompositionEvent).data;
      if (data == null) {
        // data を出さない環境。この確定は xterm の経路に任せる
        imeKey = false;
        return;
      }
      clearHelper();
      if (data) {
        sent = { data, at: Date.now() };
        sendInputRef.current(data);
      }
    };

    /**
     * 確定文字が補助 textarea に書き込まれたときに来る。ここで textarea を空に戻し、
     * xterm には渡さない。compositionend で送った直後なら二度目なので捨てる。
     */
    const onInput = (e: Event) => {
      if (composing) return; // 変換の途中経過。IME の下敷きを壊さない
      const data = (e as InputEvent).data;
      if (data == null) return; // 削除など、文字を伴わない変更は xterm に任せる
      if (!imeKey && !sent) return; // IME 由来でなければ今までどおり
      clearHelper();
      e.stopPropagation();
      // 確定直後に同じ文字が戻ってきただけなら送らない。時間で区切るのは、
      // 同じ文字を続けて打ったときに 2 文字目まで消さないため
      if (sent && sent.data === data && Date.now() - sent.at < 500) {
        sent = null;
        return;
      }
      sent = null;
      sendInputRef.current(data);
    };

    // xterm 自身のリスナーは textarea（イベントの target）に付いている。
    // 先に動かす必要があるので、祖先である host の capture 段階で受ける。
    host.addEventListener('keydown', onKeyDown, true);
    host.addEventListener('compositionstart', onCompositionStart, true);
    host.addEventListener('compositionend', onCompositionEnd, true);
    host.addEventListener('input', onInput, true);
    host.addEventListener('mousedown', swallowRightButton, true);
    host.addEventListener('mouseup', swallowRightButton, true);
    host.addEventListener('contextmenu', onContextMenu, true);
    host.addEventListener('mouseup', copySelection);

    return () => {
      ro.disconnect();
      host.removeEventListener('keydown', onKeyDown, true);
      host.removeEventListener('compositionstart', onCompositionStart, true);
      host.removeEventListener('compositionend', onCompositionEnd, true);
      host.removeEventListener('input', onInput, true);
      host.removeEventListener('mousedown', swallowRightButton, true);
      host.removeEventListener('mouseup', swallowRightButton, true);
      host.removeEventListener('contextmenu', onContextMenu, true);
      host.removeEventListener('mouseup', copySelection);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.fontSize = fontSize;
      termRef.current.options.lineHeight = lineHeight;
      safeFitRef.current();
    }
  }, [fontSize, lineHeight]);

  // 接続（セッション・モードが変わったら張り直す）
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit || !sessionId) return;

    onStatus?.({ connected: false, message: '接続中…' });

    let disposed = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const disposables: { dispose(): void }[] = [];

    // 入出力の橋渡しは張り直しても増えないよう、接続の外で一度だけ繋ぐ
    disposables.push(
      term.onData((data) => sendInputRef.current(data)),
      term.onResize(({ cols: c, rows: r }) => {
        const s = wsRef.current;
        if (s?.readyState === WebSocket.OPEN) {
          s.send(JSON.stringify({ type: 'resize', cols: c, rows: r }));
        }
      }),
    );

    /**
     * 切れたら黙って張り直す。電車の中やスリープ復帰で WebSocket は普通に落ちるが、
     * tmux 側のセッションは生きているので、繋ぎ直せば続きから使える。
     */
    const scheduleRetry = () => {
      if (disposed) return;
      const delay = Math.min(500 * 2 ** attempt, 5000);
      attempt += 1;
      onStatus?.({ connected: false, message: '切断されました。再接続しています…' });
      retry = setTimeout(start, delay);
    };

    const start = () => {
      if (disposed) return;
      // 張り直しのたびに tmux が画面全体を描き直すので、二重描画を避けて消しておく
      term.reset();
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
        attempt = 0;
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
        if (!disposed) scheduleRetry();
      };
    };

    /** 復帰の合図が来たら、待ち時間を飛ばしてすぐ繋ぎに行く */
    const wake = () => {
      if (disposed || document.visibilityState !== 'visible') return;
      const s = wsRef.current;
      if (s && (s.readyState === WebSocket.OPEN || s.readyState === WebSocket.CONNECTING)) return;
      clearTimeout(retry);
      attempt = 0;
      start();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);

    const timer = setTimeout(start, 30);

    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(retry);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
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
