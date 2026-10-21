import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

const fail = (status, message) => Object.assign(new Error(message), { status });
const allowedApi = /^\/api\/(?:state|action|capture|keys|files(?:\/(?:open|upload|archive))?|projects\/(?:recent|start)|claude\/remote-control|desktop\/(?:ping|status|clipboard)|screen\/(?:status|stream))$/;

export function validateDevice(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) throw fail(400, 'デバイス名を入力してください');
  let url;
  try { url = new URL(input.url); } catch { throw fail(400, 'http(s) の接続先URLを入力してください'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw fail(400, '接続先は http(s)://ホスト名:ポート の形式で入力してください');
  if (input.token != null && (typeof input.token !== 'string' || input.token.length > 4096 || /[\r\n]/.test(input.token))) throw fail(400, 'トークンが無効です');
  return { name: input.name.trim(), url: url.origin, token: input.token || '' };
}

/** 保存先はサーバ側だけに置き、接続先のトークンは一覧に返さない。 */
export function createDevices({ file = process.env.TMUX_WEB_DEVICES_FILE || path.join(os.homedir(), '.config/tmux-web/devices.json') } = {}) {
  let devices = [];
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(saved)) throw new Error('devices.json must be an array');
    devices = saved.map(item => {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || item.id === 'local') throw new Error('Invalid device id');
      return { id: item.id, ...validateDevice(item) };
    });
    if (new Set(devices.map(d => d.id)).size !== devices.length) throw new Error('Duplicate device id');
  }
  const sockets = new Map();
  const save = next => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(temp, file);
      devices = next;
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  };
  const get = id => {
    const device = devices.find(d => d.id === id);
    if (!device) throw fail(404, 'デバイスが見つかりません');
    return device;
  };
  const publicList = () => [{ id: 'local', name: 'このPC', local: true }, ...devices.map(({ id, name, url, token }) => ({ id, name, url, hasToken: Boolean(token), local: false }))];
  const target = (device, relative) => {
    const url = new URL(relative, device.url);
    if (url.origin !== device.url) throw fail(400, 'Invalid proxy path');
    url.searchParams.delete('token');
    return url;
  };
  const error = (res, err) => {
    if (res.headersSent) return res.destroy();
    res.status(err.status || 502).json({ error: err.status ? err.message : 'デバイスに接続できません。接続先・起動状態を確認してください' });
  };

  function install(app) {
    app.get('/api/devices', (_req, res) => res.set('Cache-Control', 'no-store').json({ devices: publicList() }));
    app.post('/api/devices', (req, res) => {
      try {
        const device = { id: randomUUID(), ...validateDevice(req.body) };
        if (devices.some(d => d.url === device.url)) throw fail(409, 'この接続先は登録済みです');
        save([...devices, device]);
        res.status(201).json({ id: device.id });
      } catch (err) { error(res, err); }
    });
    app.put('/api/devices/:id', (req, res) => {
      try {
        const previous = get(req.params.id);
        const next = { id: previous.id, ...validateDevice({ ...req.body, token: req.body?.token === undefined ? previous.token : req.body.token }) };
        if (devices.some(d => d.id !== previous.id && d.url === next.url)) throw fail(409, 'この接続先は登録済みです');
        save(devices.map(d => d.id === next.id ? next : d));
        for (const ws of sockets.get(next.id) || []) ws.terminate();
        res.json({ ok: true });
      } catch (err) { error(res, err); }
    });
    app.delete('/api/devices/:id', (req, res) => {
      try {
        get(req.params.id);
        save(devices.filter(d => d.id !== req.params.id));
        for (const ws of sockets.get(req.params.id) || []) ws.terminate();
        res.json({ ok: true });
      } catch (err) { error(res, err); }
    });
    app.all('/api/devices/:id/proxy/*', (req, res) => {
      try {
        const device = get(req.params.id);
        const relative = '/' + req.params[0];
        if (!allowedApi.test(relative) && relative !== '/files/content') throw fail(404, 'この経路は中継できません');
        // sudo パスワード・デバイス登録・多段中継は許可する経路に含めない。
        const url = target(device, relative + new URL(req.originalUrl, 'http://localhost').search);
        const headers = {};
        for (const key of ['content-type', 'range', 'accept']) if (req.headers[key]) headers[key] = req.headers[key];
        if (device.token) headers['x-tmux-web-token'] = device.token;
        const body = !['GET', 'HEAD'].includes(req.method) && req.body && req.is('application/json') ? JSON.stringify(req.body) : null;
        if (body) headers['content-length'] = Buffer.byteLength(body);
        const upstream = (url.protocol === 'https:' ? https : http).request(url, { method: req.method, headers }, incoming => {
          res.status(incoming.statusCode);
          for (const key of ['content-type', 'content-length', 'content-disposition', 'content-range', 'accept-ranges', 'cache-control', 'x-content-type-options', 'content-security-policy', 'referrer-policy']) {
            if (incoming.headers[key]) res.set(key, incoming.headers[key]);
          }
          incoming.on('error', () => res.destroy());
          incoming.pipe(res);
        });
        upstream.setTimeout(15000, () => upstream.destroy(new Error('timeout')));
        upstream.on('error', err => error(res, err));
        res.on('close', () => upstream.destroy());
        if (body) upstream.end(body); else req.pipe(upstream);
      } catch (err) { error(res, err); }
    });
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  function upgrade(req, socket, head, url) {
    const match = /^\/ws\/devices\/([a-zA-Z0-9_-]+)\/(events|terminal|desktop)$/.exec(url.pathname);
    if (!match) return false;
    let device;
    try { device = get(match[1]); }
    catch { socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); return true; }
    const remote = target(device, `/ws/${match[2]}${url.search}`);
    remote.protocol = remote.protocol === 'https:' ? 'wss:' : 'ws:';
    if (device.token) remote.searchParams.set('token', device.token);
    wss.handleUpgrade(req, socket, head, client => {
      const upstream = new WebSocket(remote, { handshakeTimeout: 8000, maxPayload: 8 * 1024 * 1024 });
      const set = sockets.get(device.id) || new Set();
      sockets.set(device.id, set); set.add(client); set.add(upstream);
      const pending = [];
      let pendingBytes = 0;
      const send = (to, data, binary) => {
        if (to.readyState !== WebSocket.OPEN) return;
        if (to.bufferedAmount > 8 * 1024 * 1024) { client.terminate(); upstream.terminate(); return; }
        to.send(data, { binary });
      };
      client.on('message', (data, binary) => {
        if (upstream.readyState === WebSocket.OPEN) send(upstream, data, binary);
        else if (upstream.readyState === WebSocket.CONNECTING) {
          pendingBytes += data.length;
          if (pendingBytes > 1024 * 1024) { client.close(1009); upstream.terminate(); }
          else pending.push([data, binary]);
        }
      });
      upstream.on('open', () => {
        if (client.readyState !== WebSocket.OPEN) { upstream.close(); return; }
        for (const [data, binary] of pending) send(upstream, data, binary);
        pending.length = 0;
      });
      upstream.on('message', (data, binary) => send(client, data, binary));
      const close = () => { set.delete(client); set.delete(upstream); client.terminate(); upstream.terminate(); };
      client.on('close', close); client.on('error', close);
      upstream.on('close', close); upstream.on('error', close);
    });
    return true;
  }
  return { install, upgrade, dispose() { for (const set of sockets.values()) for (const ws of set) ws.terminate(); wss.close(); } };
}
