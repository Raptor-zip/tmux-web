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
  actions,
  isKnownAction,
  TmuxError,
} from './tmux.js';
import { installScreen } from './screen.js';
import { createDesktop, readDesktopClipboard, writeDesktopClipboard } from './desktop.js';
import { assertLoopbackHost, createTailscaleAuth } from './auth.js';
import { createDevices } from './devices.js';
import { installDevice } from './device.js';
import { installFiles } from './files.js';
import { installWorkspaces } from './workspaces.js';
import { createApprovals } from './approvals.js';
import { cleanupOrphanMirrors } from './attach.js';
import { connectTerminal, TERMINAL_MAX_PAYLOAD } from './terminal.js';
import { visibleState, stateSignature } from './state.js';
import { installWeb } from './web.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '../../web/dist');

const PORT = Number(process.env.PORT || 7654);
const HOST = process.env.HOST || '127.0.0.1';
assertLoopbackHost(HOST);
const auth = createTailscaleAuth();
await auth.refresh();
const authRefreshTimer = setInterval(() => { void auth.refresh(); }, 30000);
authRefreshTimer.unref();

const app = express();
app.use(express.json({ limit: '1mb' }));
const approvals = createApprovals();
approvals.installHelpers(app);

// ---------------------------------------------------------------------------
// 認証: Tailscale Serveが付与した利用者情報を確認する。
// ---------------------------------------------------------------------------
app.get('/api/auth', (req, res) => {
  const result = auth.authorize(req);
  res.set('Cache-Control', 'no-store').status(result.status).json({
    auth: 'tailscale', authenticated: result.status === 200, user: result.user,
    error: result.error, publicUrl: auth.publicURL(),
  });
});
app.use('/api', auth.middleware);
app.use('/files', auth.middleware);

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

const devices = createDevices();
devices.install(app);

app.get('/api/state', async (_req, res) => {
  try {
    const [state, info] = await Promise.all([snapshot(), serverInfo()]);
    // WS の push と同じ絞り込みを通す。ここだけ素通しすると初回描画で一瞬だけ違う
    res.json({ ...visibleState(state), server: info, authRequired: true, auth: { mode: 'tailscale', user: _req.auth } });
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

approvals.install(app);
installWorkspaces(app, async (id) => (await snapshot()).panes.find(pane => pane.id === id));

installFiles(app, async (id) => (await snapshot()).panes.find((pane) => pane.id === id));

installDevice(app);
const screenCapture = installScreen(app);
const desktop = createDesktop();
app.get('/api/desktop/ping', (_req, res) => res.set('Cache-Control', 'no-store').json({ ok: true }));
app.get('/api/desktop/status', async (_req, res) => res.json(await desktop.status()));
app.get('/api/desktop/clipboard', async (_req, res) => {
  try { res.json({ text: await readDesktopClipboard() }); }
  catch (err) { res.status(503).json({ error: err.message }); }
});
app.post('/api/desktop/clipboard', async (req, res) => {
  if (typeof req.body?.text !== 'string') return res.status(400).json({ error: 'text is required' });
  try { await writeDesktopClipboard(req.body.text); res.json({ ok: true }); }
  catch (err) { res.status(503).json({ error: err.message }); }
});

// 本番ビルドがあれば静的配信する（開発時は Vite が担当）
if (fs.existsSync(WEB_DIST)) {
  installWeb(app, WEB_DIST);
}

const server = http.createServer(app);

// ---------------------------------------------------------------------------
// WebSocket: 状態の push
// ---------------------------------------------------------------------------
const eventsWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const terminalWss = new WebSocketServer({ noServer: true, maxPayload: TERMINAL_MAX_PAYLOAD });

let lastStateJson = '';
let pollTimer = null;
let polling = false;
let pollSoonTimer = null;

async function pollState() {
  if (eventsWss.clients.size === 0 || polling) return;
  polling = true;
  try {
    const state = await snapshot();
    const message = { type: 'state', ...visibleState(state) };
    const signature = stateSignature(message);
    if (signature === lastStateJson) return;
    lastStateJson = signature;
    const json = JSON.stringify(message);
    for (const ws of eventsWss.clients) {
      if (ws.readyState === ws.OPEN) ws.send(json);
    }
  } catch {
    /* tmux サーバが落ちている場合は次のポーリングで復帰する */
  } finally {
    polling = false;
  }
}

function broadcastStateSoon() {
  lastStateJson = '';
  clearTimeout(pollSoonTimer);
  pollSoonTimer = setTimeout(pollState, 60);
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
terminalWss.on('connection', (ws, req) => {
  void connectTerminal(ws, req, broadcastStateSoon);
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  const authenticated = auth.authorize(req);
  if (authenticated.status !== 200) {
    socket.write(`HTTP/1.1 ${authenticated.status} ${authenticated.status === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
    return;
  }
  if (devices.upgrade(req, socket, head, url)) return;
  if (url.pathname === '/ws/desktop') {
    desktop.upgrade(req, socket, head);
  } else if (url.pathname === '/ws/events') {
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
  console.log('[tmux-web] Tailscale認証が有効です。アクセス先:', auth.publicURL() || 'Tailscale ServeのURL');
});

const shutdown = async () => {
  clearInterval(pollTimer);
  clearTimeout(pollSoonTimer);
  clearInterval(authRefreshTimer);
  approvals.dispose();
  devices.dispose();
  screenCapture.dispose();
  desktop.dispose();
  await cleanupOrphanMirrors().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
