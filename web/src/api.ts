import { useEffect, useMemo, useRef, useState } from 'react';
import { deviceOf, unscoped, scoped, devicePath, scopeState, routeAction, type Device } from './devices';
import type { ActionName, KeyBinding, TmuxState } from './types';

/** ?token=... を付けて起動した場合、以降のリクエストにも引き継ぐ */
export const TOKEN = new URLSearchParams(location.search).get('token');

function withToken(url: string): string {
  if (!TOKEN) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN);
}

export class AuthError extends Error {}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(withToken(url), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { 'x-tmux-web-token': TOKEN } : {}),
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new AuthError('unauthorized');
  if (!res.ok) throw new Error((body as { error?: string }).error || res.statusText);
  return body as T;
}

export async function runAction(action: ActionName, params: Record<string, unknown> = {}): Promise<{ ok: true; result: string | null }> {
  // 一括片付けはデバイスごとに送り、それ以外の混在操作は拒否する。
  if (action === 'killIdleWindows' && Array.isArray(params.targets)) {
    const ids = params.targets as string[];
    if (new Set(ids.map(deviceOf)).size > 1) {
      const results = await Promise.all([...new Set(ids.map(deviceOf))].map(device => runAction(action, { targets: ids.filter(id => deviceOf(id) === device) })));
      return { ok: true as const, result: String(results.reduce((n, r) => n + Number(r.result || 0), 0)) };
    }
  }
  const route = routeAction(params);
  const result = await request<{ ok: true; result: string | null }>(devicePath(route.device, '/api/action'), {
    method: 'POST', body: JSON.stringify({ action, params: route.params }),
  });
  if (result.result && ['newSession', 'newWindow', 'launchAgent', 'splitPane'].includes(action)) result.result = scoped(route.device, result.result);
  return result;
}

export function fetchState(device = 'local') {
  return request<TmuxState>(devicePath(device, '/api/state'));
}

export function fetchCapture(target: string, lines = 2000, plain = false) {
  return request<{ target: string; text: string }>(devicePath(deviceOf(target),
    `/api/capture?target=${encodeURIComponent(unscoped(target))}&lines=${lines}${plain ? '&plain=1' : ''}`));
}

export function fetchKeys(table = 'prefix', device = 'local') {
  return request<{ keys: KeyBinding[] }>(devicePath(device, `/api/keys?table=${encodeURIComponent(table)}`));
}

export function wsUrl(path: string, params: Record<string, string | number> = {}, device = 'local') {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const values = { ...params };
  if (typeof values.session === 'string') device = deviceOf(values.session);
  for (const key of ['session', 'window']) if (typeof values[key] === 'string') values[key] = unscoped(values[key] as string);
  const qs = new URLSearchParams(Object.entries(values).map(([k, v]) => [k, String(v)]));
  if (TOKEN) qs.set('token', TOKEN);
  const route = device === 'local' ? path : `/ws/devices/${encodeURIComponent(device)}/${path.slice('/ws/'.length)}`;
  return `${proto}//${location.host}${route}?${qs.toString()}`;
}

export const listDevices = () => request<{ devices: Device[] }>('/api/devices');
export const addDevice = (device: { name: string; url: string; token: string }) => request<{ id: string }>('/api/devices', { method: 'POST', body: JSON.stringify(device) });
export const removeDevice = (id: string) => request('/api/devices/' + encodeURIComponent(id), { method: 'DELETE' });

/** デバイスごとに状態と接続を保持する。一台の切断で他の端末を巻き込まない。 */
export function useTmuxState() {
  const [devices, setDevices] = useState<Device[]>([{ id: 'local', name: 'このPC', local: true }]);
  const [records, setRecords] = useState<Record<string, { state?: TmuxState; connected: boolean; error?: string }>>({});
  const [unauthorized, setUnauthorized] = useState(false);
  const [revision, setRevision] = useState(0);
  const sockets = useRef(new Map<string, WebSocket>());
  const reloadDevices = () => setRevision(v => v + 1);
  useEffect(() => {
    let stopped = false;
    listDevices().then(data => { if (!stopped) { setDevices(data.devices); setUnauthorized(false); } })
      .catch(err => { if (!stopped) setUnauthorized(err instanceof AuthError); });
    return () => { stopped = true; };
  }, [revision]);
  const signature = JSON.stringify(devices.map(({ id, name, url }) => ({ id, name, url })));
  useEffect(() => {
    let stopped = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const controllers: AbortController[] = [];
    for (const device of devices) {
      let server: TmuxState['server'];
      const update = (value: Partial<{ state: TmuxState; connected: boolean; error: string }>) => {
        if (!stopped) setRecords(prev => ({ ...prev, [device.id]: { ...prev[device.id], connected: false, ...value, ...(value.state ? { state: { ...value.state, server: value.state.server ?? prev[device.id]?.state?.server } } : {}) } }));
      };
      const connect = () => {
        if (stopped) return;
        const ws = new WebSocket(wsUrl('/ws/events', {}, device.id));
        sockets.current.set(device.id, ws);
        // REST が成功してから接続済みとする。中継のWS自体は先に開くことがある。
        const controller = new AbortController(); controllers.push(controller);
        request<TmuxState>(devicePath(device.id, '/api/state'), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) })
          .then(state => { server = state.server; update({ state: scopeState(device, state), connected: true, error: '' }); })
          .catch(err => { if (!controller.signal.aborted) update({ connected: false, error: err.message }); });
        ws.onmessage = ev => {
          try {
            const message = JSON.parse(ev.data);
            if (message.type === 'state') update({ state: scopeState(device, { ...message, server }), connected: true, error: '' });
          } catch { /* ignore malformed frames */ }
        };
        ws.onclose = () => {
          controller.abort(); update({ connected: false, error: '切断・再接続中' });
          if (!stopped) { const timer = setTimeout(() => { timers.delete(timer); connect(); }, 2500); timers.add(timer); }
        };
        ws.onerror = () => ws.close();
      };
      connect();
    }
    return () => {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      for (const controller of controllers) controller.abort();
      for (const ws of sockets.current.values()) ws.close();
      sockets.current.clear();
    };
  }, [signature]);
  const { available, state } = useMemo(() => {
    const available = devices.map(d => ({ ...d, connected: records[d.id]?.connected || false, error: records[d.id]?.error, server: records[d.id]?.state?.server, serverPid: records[d.id]?.state?.serverPid }));
    const snapshots = devices.flatMap(d => records[d.id]?.state ? [records[d.id].state!] : []);
    const state: TmuxState | null = snapshots.length ? {
      sessions: snapshots.flatMap(s => s.sessions), windows: snapshots.flatMap(s => s.windows), panes: snapshots.flatMap(s => s.panes),
      ts: Date.now(), server: records.local?.state?.server, serverPid: records.local?.state?.serverPid,
    } : null;
    return { available, state };
  }, [devices, records]);
  const refresh = () => { for (const ws of sockets.current.values()) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'refresh' })); };
  return { state, devices: available, connected: !!records.local?.connected, unauthorized, refresh, reloadDevices };
}

export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  size: number;
  modified: number;
  mime: string;
}
export interface FileListing {
  root: string;
  path: string;
  items: FileEntry[];
}
export function fetchFiles(pane: string, path = '', signal?: AbortSignal) {
  return request<FileListing>(devicePath(deviceOf(pane), `/api/files?${new URLSearchParams({ pane: unscoped(pane), path })}`), { signal });
}
export async function openFile(pane: string, path: string, root: string) {
  const device = deviceOf(pane);
  const result = await request<{ url: string }>(devicePath(device, '/api/files/open'), { method: 'POST', body: JSON.stringify({ pane: unscoped(pane), path, root }) });
  return { url: withToken(devicePath(device, result.url)) };
}

export interface ScreenStatus {
  available: boolean;
  width?: number;
  height?: number;
  fps?: number;
  viewers: number;
  streaming: boolean;
  error?: string | null;
}
export function fetchScreenStatus(signal?: AbortSignal) {
  return request<ScreenStatus>('/api/screen/status', { signal });
}
export function screenStreamUrl(attempt: number) {
  return withToken(`/api/screen/stream?attempt=${attempt}`);
}

export interface DesktopStatus {
  available: boolean;
  width?: number;
  height?: number;
  viewers: number;
  error?: string;
}
export function fetchDesktopStatus(signal?: AbortSignal, device = 'local') {
  return request<DesktopStatus>(devicePath(device, '/api/desktop/status'), { signal });
}

export async function measureDesktopRoundTrip(signal?: AbortSignal, device = 'local') {
  const start = performance.now();
  await request<{ ok: boolean }>(devicePath(device, '/api/desktop/ping'), { signal, cache: 'no-store' });
  return Math.round(performance.now() - start);
}

export function readDesktopClipboard(device = 'local') {
  return request<{ text: string }>(devicePath(device, '/api/desktop/clipboard'));
}
export function writeDesktopClipboard(text: string, device = 'local') {
  return request<{ ok: true }>(devicePath(device, '/api/desktop/clipboard'), { method: 'POST', body: JSON.stringify({ text }) });
}

export interface RecentProject { name: string; cwd: string; sessionId: string; modified: number; summary: string }
export interface StartedProject { sessionId: string; windowId: string; paneId: string; cwd: string }
export interface StartProjectOptions {
  mode: 'new' | 'existing'; name?: string; parent?: string; dir?: string;
  template?: 'none' | 'node' | 'python'; agent?: 'claude' | 'codex' | 'shell';
  prompt?: string; resumeId?: string; remoteControl?: boolean;
}
export const recentProjects = (signal?: AbortSignal, device = 'local') => request<{ projects: RecentProject[] }>(devicePath(device, '/api/projects/recent'), { signal });
export const startProject = async (options: StartProjectOptions, device = 'local') => {
  const result = await request<StartedProject>(devicePath(device, '/api/projects/start'), { method: 'POST', body: JSON.stringify(options) });
  return { ...result, sessionId: scoped(device, result.sessionId), windowId: scoped(device, result.windowId), paneId: scoped(device, result.paneId) };
};
export const remoteControl = (pane: string, connect = true) => request<{ url?: string; pending?: boolean }>(devicePath(deviceOf(pane), '/api/claude/remote-control'), { method: 'POST', body: JSON.stringify({ pane: unscoped(pane), connect }) });
export async function uploadFile(pane: string, path: string, root: string, file: File, signal?: AbortSignal) {
  const res = await fetch(withToken(devicePath(deviceOf(pane), `/api/files/upload?${new URLSearchParams({ pane: unscoped(pane), path, root, name: file.name })}`)), {
    method: 'POST', body: file, signal, headers: { 'Content-Type': 'application/octet-stream', ...(TOKEN ? { 'x-tmux-web-token': TOKEN } : {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 413 ? '1ファイルは50MBまでです。' : body.error || 'アップロードできませんでした');
  return body as { name: string };
}
export const archiveFiles = async (pane: string, path: string, root: string) => {
  const device = deviceOf(pane);
  const result = await request<{ url: string }>(devicePath(device, '/api/files/archive'), { method: 'POST', body: JSON.stringify({ pane: unscoped(pane), path, root }) });
  return { url: withToken(devicePath(device, result.url)) };
};
export interface Approval { id: string; cmd: string; cwd: string; detail: string; attempt: number; expiresAt: number }
export const fetchApproval = (signal?: AbortSignal) => request<{ pending: Approval | null; secure: boolean }>('/api/approvals', { signal, cache: 'no-store' });
export const answerApproval = (id: string, password: string) => request('/api/approvals/answer', { method: 'POST', body: JSON.stringify({ id, password }) });
export const cancelApproval = (id: string) => request('/api/approvals/cancel', { method: 'POST', body: JSON.stringify({ id }) });
