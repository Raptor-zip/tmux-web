import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

export const WORKSPACE_MAX_PAYLOAD = 1024 * 1024;
const keyPattern = /^tw\.(?:desktops|(?:layout|focusedLeaf|serverPid|device)(?:\.[a-zA-Z0-9_-]{1,80})?)$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max;

function validValue(key, raw) {
  if (!keyPattern.test(key) || typeof raw !== 'string') return false;
  let value;
  try { value = JSON.parse(raw); } catch { return false; }
  if (key === 'tw.desktops') {
    return object(value) && Array.isArray(value.items) && value.items.length > 0 && value.items.length <= 100
      && value.items.every(item => object(item) && /^[a-zA-Z0-9_-]{1,80}$/.test(item.id) && text(item.name, 60))
      && new Set(value.items.map(item => item.id)).size === value.items.length
      && value.items.some(item => item.id === value.activeId);
  }
  if (key.startsWith('tw.layout')) {
    let count = 0;
    const ids = new Set();
    const walk = (node, depth = 0) => {
      if (!object(node) || depth > 24 || ++count > 4096 || !text(node.id) || ids.has(node.id)) return false;
      ids.add(node.id);
      if (node.type === 'split') return ['row', 'column'].includes(node.dir) && Number.isFinite(node.ratio)
        && node.ratio > 0 && node.ratio < 1 && walk(node.a, depth + 1) && walk(node.b, depth + 1);
      if (node.type !== 'leaf' || !Array.isArray(node.tabs) || !node.tabs.length || node.tabs.length > 1000) return false;
      return node.tabs.every(tab => {
        if (!object(tab) || !text(tab.id) || ids.has(tab.id) || !text(tab.sessionId) || !(tab.windowId === null || text(tab.windowId))) return false;
        ids.add(tab.id); return true;
      }) && node.tabs.some(tab => tab.id === node.activeId);
    };
    return value === null || walk(value);
  }
  if (key.startsWith('tw.focusedLeaf')) return value === null || text(value);
  if (key.startsWith('tw.device')) return text(value, 100);
  return value === null || (typeof value === 'number' && Number.isFinite(value)) || text(value, 32000);
}

/** One workspace per tmux-web server, shared by its authenticated clients. */
export function createWorkspaceSync({ file = process.env.TMUX_WEB_WORKSPACE_FILE || path.join(os.homedir(), '.config/tmux-web/workspace.json') } = {}) {
  let values = {};
  let revision = 0;
  let initialized = false;
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!object(saved.values) || !Object.hasOwn(saved.values, 'tw.desktops')
        || !Object.entries(saved.values).every(([key, raw]) => validValue(key, raw))) throw new Error('Invalid workspace.json');
    values = saved.values;
    revision = Number.isSafeInteger(saved.revision) ? saved.revision : 0;
    initialized = true;
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: WORKSPACE_MAX_PAYLOAD });
  const snapshot = extra => JSON.stringify({ type: 'workspace', initialized, revision, values, ...extra });
  const send = (ws, data) => {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > WORKSPACE_MAX_PAYLOAD * 2) { ws.terminate(); return; }
    ws.send(data);
  };
  const save = next => {
    const json = JSON.stringify({ revision: revision + 1, values: next });
    if (Buffer.byteLength(json) > WORKSPACE_MAX_PAYLOAD - 4096) throw new Error('配置の保存容量を超えました');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, json + '\n', { mode: 0o600 });
      fs.renameSync(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    values = next;
    revision++;
    initialized = true;
  };
  wss.on('connection', ws => {
    send(ws, snapshot());
    ws.on('error', () => {});
    ws.on('message', raw => {
      let message;
      try {
        message = JSON.parse(raw.toString());
        if (message?.type === 'refresh') { send(ws, snapshot()); return; }
        if (message?.type !== 'workspace-patch' || !text(message.id, 100) || !object(message.changes)
            || !Object.keys(message.changes).length || Object.keys(message.changes).length > 501) throw new Error('配置の更新形式が無効です');
        for (const [key, change] of Object.entries(message.changes)) {
          if (!keyPattern.test(key) || !object(change) || !(change.before === null || typeof change.before === 'string')
              || !(change.after === null || validValue(key, change.after))) throw new Error('配置の更新内容が無効です');
        }
        // Compare the touched keys, so unrelated desktops can be edited concurrently.
        // A move changes both desktops in one patch and either succeeds entirely or fails entirely.
        if ((message.seed && initialized) || (!message.seed && !initialized)
            || Object.entries(message.changes).some(([key, change]) => (values[key] ?? null) !== change.before)) {
          send(ws, snapshot({ ack: message.id, conflict: true })); return;
        }
        const next = { ...values };
        for (const [key, change] of Object.entries(message.changes)) {
          if (change.after === null) delete next[key]; else next[key] = change.after;
        }
        if (!next['tw.desktops']) throw new Error('デスクトップが必要です');
        const desktops = new Set(JSON.parse(next['tw.desktops']).items.map(item => item.id));
        for (const key of Object.keys(next)) {
          const match = key.match(/^tw\.(?:layout|focusedLeaf|serverPid|device)(?:\.([a-zA-Z0-9_-]+))?$/);
          if (match && !desktops.has(match[1] || 'main')) delete next[key];
        }
        save(next);
        for (const client of wss.clients) send(client, snapshot(client === ws ? { ack: message.id } : undefined));
      } catch (error) {
        send(ws, snapshot({ ack: text(message?.id, 100) ? message.id : undefined, error: error.message || '配置を保存できませんでした' }));
      }
    });
  });
  return {
    upgrade(req, socket, head) { wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws)); },
    dispose() { for (const ws of wss.clients) ws.terminate(); wss.close(); },
  };
}
