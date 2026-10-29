import { createAttachment } from './attach.js';

export const TERMINAL_MAX_PAYLOAD = 8 * 1024 * 1024;
const MAX_PENDING_BYTES = 1024 * 1024;
const MAX_PENDING_MESSAGES = 1024;
const MAX_COLS = 2000;
const MAX_ROWS = 1000;
const dimension = (value, fallback, max) => Number.isSafeInteger(value) && value >= 2 ? Math.min(value, max) : fallback;

function parseMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.type === 'input' && typeof value.data === 'string' && value.data) return { type: 'input', data: value.data };
  if (value.type === 'resize' && Number.isSafeInteger(value.cols) && value.cols >= 2
      && Number.isSafeInteger(value.rows) && value.rows >= 2) {
    return { type: 'resize', cols: Math.min(value.cols, MAX_COLS), rows: Math.min(value.rows, MAX_ROWS) };
  }
  if (value.type === 'selectWindow' && Number.isSafeInteger(value.index) && value.index >= 0) {
    return { type: 'selectWindow', index: value.index };
  }
  return null;
}

export async function connectTerminal(ws, req, broadcastStateSoon, attach = createAttachment) {
  const url = new URL(req.url, 'http://localhost');
  const sessionId = url.searchParams.get('session');
  const windowId = url.searchParams.get('window');
  const cols = dimension(Number(url.searchParams.get('cols') || 80), 80, MAX_COLS);
  const rows = dimension(Number(url.searchParams.get('rows') || 24), 24, MAX_ROWS);
  const mode = url.searchParams.get('mode') === 'direct' ? 'direct' : 'mirror';
  const showStatusBar = url.searchParams.get('status') === '1';

  let attachment = null;
  const pending = [];
  const listeners = [];
  let pendingBytes = 0;
  let draining = false;
  let ready = false;
  let closed = false;
  let disposed = false;
  const dispose = async () => {
    if (!attachment || disposed) return;
    disposed = true;
    await attachment.dispose();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    pending.length = 0;
    pendingBytes = 0;
    for (const listener of listeners) { try { listener?.dispose(); } catch { /* Already released. */ } }
    void dispose().finally(broadcastStateSoon).catch(() => {});
  };
  const fail = (message, code = 1011) => {
    if (closed) return;
    if (ws.readyState === ws.OPEN) {
      try { ws.send(JSON.stringify({ type: 'error', message })); } catch { /* Socket already failed. */ }
      try { ws.close(code); } catch { ws.terminate?.(); }
    }
    close();
  };
  ws.on('close', close);
  ws.on('error', () => fail('端末との接続が切れました。再接続してください。'));

  // A window selection is asynchronous. Never write the next keystroke to the
  // previously selected window while tmux is still completing that selection.
  const drain = async () => {
    if (!attachment || !ready || draining || closed) return;
    draining = true;
    try {
      while (pending.length && !closed) {
        const { message, bytes } = pending.shift();
        pendingBytes -= bytes;
        if (message.type === 'input') attachment.pty.write(message.data);
        else if (message.type === 'resize') attachment.pty.resize(message.cols, message.rows);
        else await attachment.selectWindowIndex(message.index);
      }
    } catch {
      fail('端末の操作に失敗しました。再接続してください。');
    } finally { draining = false; }
  };
  const enqueue = message => {
    if (closed || !message) return;
    const bytes = message.type === 'input' ? Buffer.byteLength(message.data) : 32;
    if (pending.length >= MAX_PENDING_MESSAGES || pendingBytes + bytes > MAX_PENDING_BYTES) {
      fail('待機中の入力が多すぎます。再接続後に貼り付け直してください。', 1009);
      return;
    }
    pending.push({ message, bytes });
    pendingBytes += bytes;
    void drain();
  };
  ws.on('message', (raw, isBinary) => {
    if (closed) return;
    try {
      enqueue(parseMessage(isBinary ? { type: 'input', data: raw.toString('utf8') } : JSON.parse(raw.toString())));
    } catch { /* Ignore malformed frames before they enter the queue. */ }
  });

  try {
    attachment = await attach({ sessionId, windowId, cols, rows, mode, showStatusBar });
    if (closed || ws.readyState !== ws.OPEN) {
      await dispose().catch(() => {});
      return;
    }
    listeners.push(attachment.pty.onData(data => {
      if (closed || ws.readyState !== ws.OPEN) return;
      if (ws.bufferedAmount > TERMINAL_MAX_PAYLOAD) {
        fail('端末の配信が追いつきません。再接続してください。', 1013);
        return;
      }
      try {
        // tmux must initialize its terminal before queued keystrokes are safe.
        if (!ready) {
          ready = true;
          ws.send(JSON.stringify({ type: 'ready', attachTarget: attachment.attachTarget, mirrorName: attachment.mirrorName, mode }));
        }
        ws.send(Buffer.from(data, 'utf8'));
        void drain();
      }
      catch { fail('端末との接続が切れました。再接続してください。'); }
    }));
    listeners.push(attachment.pty.onExit(({ exitCode }) => {
      if (closed) return;
      if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify({ type: 'exit', exitCode })); ws.close(); }
        catch { ws.terminate?.(); }
      }
      close();
    }));
    await drain();
  } catch (error) {
    fail(String(error.message || error));
  }
}
