import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import { WebSocketServer } from 'ws';

import {
  snapshot,
  serverInfo,
  capturePane,
  listKeys,
  actions,
  isKnownAction,
  TmuxError,
} from './tmux.js';
import { createAttachment, cleanupOrphanMirrors, isMirrorSession } from './attach.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '../../web/dist');

const PORT = Number(process.env.PORT || 7654);
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = process.env.TMUX_WEB_TOKEN || null;

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------------------
// 認証（TMUX_WEB_TOKEN を設定したときだけ有効）
// ---------------------------------------------------------------------------
function checkToken(req) {
  if (!TOKEN) return true;
  const header = req.headers['x-tmux-web-token'];
  if (header === TOKEN) return true;
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('token') === TOKEN;
}

app.use('/api', (req, res, next) => {
  if (!checkToken(req)) return res.status(401).json({ error: 'unauthorized' });
  next();
});

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

app.get('/api/state', async (_req, res) => {
  try {
    const [state, info] = await Promise.all([snapshot(), serverInfo()]);
    // WS の push と同じ絞り込みを通す。ここだけ素通しすると初回描画で一瞬だけ違う
    res.json({ ...visibleState(state), server: info, authRequired: Boolean(TOKEN) });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/action', async (req, res) => {
  const { action, params = {} } = req.body || {};
  if (!isKnownAction(action)) {
    return res.status(400).json({ error: `unknown action: ${action}` });
  }
  try {
    const out = await actions[action](params);
    broadcastStateSoon();
    res.json({ ok: true, result: typeof out === 'string' ? out.trim() : null });
  } catch (err) {
    const status = err instanceof TmuxError ? 422 : 500;
    res.status(status).json({ error: String(err.message || err) });
  }
});

app.get('/api/capture', async (req, res) => {
  const { target, lines, plain } = req.query;
  if (!target) return res.status(400).json({ error: 'target is required' });
  try {
    const text = await capturePane(String(target), {
      lines: lines ? Number(lines) : 2000,
      escapes: plain !== '1',
    });
    res.json({ target, text });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get('/api/keys', async (req, res) => {
  try {
    res.json({ keys: await listKeys(String(req.query.table || 'prefix')) });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// 本番ビルドがあれば静的配信する（開発時は Vite が担当）
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
}

const server = http.createServer(app);

// ---------------------------------------------------------------------------
// WebSocket: 状態の push
// ---------------------------------------------------------------------------
const eventsWss = new WebSocketServer({ noServer: true });
const terminalWss = new WebSocketServer({ noServer: true });

let lastStateJson = '';
let pollTimer = null;

// グループを共有するセッションを 1 つにまとめるか。TMUX_WEB_SHOW_GROUP_VIEWS=1 で無効
const COLLAPSE_GROUPS = process.env.TMUX_WEB_SHOW_GROUP_VIEWS !== '1';

/**
 * 画面に出す分だけに絞る。
 *
 * - ミラー（`webmux-*`）は隠す。tmux-web が attach のために作る内部的なもの。
 * - グループを共有するセッションは 1 つだけ残す。tmux のグループはウィンドウを
 *   共有するので、`tmux new-session -t <既存>` で端末ごとに view を作る使い方だと、
 *   同じウィンドウが view の数だけ並んでしまう。中身が同じものを何度も見せない。
 *   残すのはいちばん古いもの（＝元のセッション）。
 *
 * ウィンドウとペインはセッションごとに重複して返るので、残したセッションの分だけに揃える。
 */
function visibleState(state) {
  let sessions = state.sessions.filter((s) => !isMirrorSession(s.name));

  if (COLLAPSE_GROUPS) {
    const keep = new Map(); // グループ名 -> 残すセッション
    for (const s of sessions) {
      if (!s.group || s.groupSize <= 1) continue;
      const cur = keep.get(s.group);
      if (!cur || s.created < cur.created) keep.set(s.group, s);
    }
    const kept = new Set([...keep.values()].map((s) => s.id));
    sessions = sessions.filter((s) => !s.group || s.groupSize <= 1 || kept.has(s.id));
  }

  const ids = new Set(sessions.map((s) => s.id));
  const windows = state.windows.filter((w) => ids.has(w.sessionId));
  const winIds = new Set(windows.map((w) => w.id));
  return {
    ...state,
    sessions,
    windows,
    panes: state.panes.filter((p) => winIds.has(p.windowId)),
  };
}

async function pollState() {
  if (eventsWss.clients.size === 0) return;
  try {
    const state = await snapshot();
    const json = JSON.stringify({ type: 'state', ...visibleState(state) });
    if (json === lastStateJson) return;
    lastStateJson = json;
    for (const ws of eventsWss.clients) {
      if (ws.readyState === ws.OPEN) ws.send(json);
    }
  } catch {
    /* tmux サーバが落ちている場合は次のポーリングで復帰する */
  }
}

function broadcastStateSoon() {
  lastStateJson = '';
  setTimeout(pollState, 60);
}

eventsWss.on('connection', (ws) => {
  lastStateJson = '';
  pollState();
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'refresh') broadcastStateSoon();
    } catch {
      /* ignore */
    }
  });
});

pollTimer = setInterval(pollState, 1200);
pollTimer.unref?.();

// ---------------------------------------------------------------------------
// WebSocket: ターミナル
// ---------------------------------------------------------------------------
terminalWss.on('connection', async (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const sessionId = url.searchParams.get('session');
  const windowId = url.searchParams.get('window');
  const cols = Number(url.searchParams.get('cols') || 80);
  const rows = Number(url.searchParams.get('rows') || 24);
  const mode = url.searchParams.get('mode') === 'direct' ? 'direct' : 'mirror';
  const showStatusBar = url.searchParams.get('status') === '1';

  // attach の準備には tmux を数回叩くぶんの時間がかかる。その間にブラウザが送ってきた
  // 入力やウィンドウ切り替えを取りこぼさないよう、リスナーを先に張ってキューに貯める。
  let attachment = null;
  const pending = [];

  const handleMessage = (msg) => {
    if (!attachment) {
      pending.push(msg);
      return;
    }
    switch (msg.type) {
      case 'input':
        attachment.pty.write(msg.data);
        break;
      case 'resize':
        try {
          attachment.pty.resize(Math.max(2, msg.cols | 0), Math.max(2, msg.rows | 0));
        } catch {
          /* pty がすでに閉じている */
        }
        break;
      case 'selectWindow':
        attachment.selectWindowIndex(msg.index);
        break;
      default:
        break;
    }
  };

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      handleMessage({ type: 'input', data: raw.toString('utf8') });
      return;
    }
    try {
      handleMessage(JSON.parse(raw.toString()));
    } catch {
      /* 壊れたフレームは無視 */
    }
  });

  try {
    attachment = await createAttachment({
      sessionId,
      windowId,
      cols,
      rows,
      mode,
      showStatusBar,
    });
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: String(err.message || err) }));
    ws.close();
    return;
  }

  ws.send(
    JSON.stringify({
      type: 'ready',
      attachTarget: attachment.attachTarget,
      mirrorName: attachment.mirrorName,
      mode,
    }),
  );

  // 準備中に届いていたぶんを順番に処理する
  while (pending.length) handleMessage(pending.shift());

  attachment.pty.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(Buffer.from(data, 'utf8'));
  });

  attachment.pty.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', exitCode }));
      ws.close();
    }
  });

  const close = async () => {
    await attachment.dispose();
    broadcastStateSoon();
  };
  ws.on('close', close);
  ws.on('error', close);
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (TOKEN && url.searchParams.get('token') !== TOKEN) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  if (url.pathname === '/ws/events') {
    eventsWss.handleUpgrade(req, socket, head, (ws) => eventsWss.emit('connection', ws, req));
  } else if (url.pathname === '/ws/terminal') {
    terminalWss.handleUpgrade(req, socket, head, (ws) =>
      terminalWss.emit('connection', ws, req),
    );
  } else {
    socket.destroy();
  }
});

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
const orphans = await cleanupOrphanMirrors().catch(() => []);
if (orphans.length) {
  console.log(`[tmux-web] 残っていたミラーセッションを削除: ${orphans.join(', ')}`);
}

server.listen(PORT, HOST, () => {
  console.log(`[tmux-web] http://${HOST}:${PORT}`);
  if (!fs.existsSync(WEB_DIST)) {
    console.log('[tmux-web] web/dist がありません。開発時は Vite (npm run dev) を使ってください。');
  }
  if (TOKEN) console.log('[tmux-web] トークン認証が有効です (TMUX_WEB_TOKEN)');
  else if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.warn(
      '[tmux-web] 警告: localhost 以外で待ち受けています。TMUX_WEB_TOKEN の設定を強く推奨します。',
    );
  }
});

const shutdown = async () => {
  clearInterval(pollTimer);
  await cleanupOrphanMirrors().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
