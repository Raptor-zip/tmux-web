import { useEffect, useRef, useState } from 'react';
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

export function runAction(action: ActionName, params: Record<string, unknown> = {}) {
  return request<{ ok: true; result: string | null }>('/api/action', {
    method: 'POST',
    body: JSON.stringify({ action, params }),
  });
}

export function fetchState() {
  return request<TmuxState>('/api/state');
}

export function fetchCapture(target: string, lines = 2000, plain = false) {
  return request<{ target: string; text: string }>(
    `/api/capture?target=${encodeURIComponent(target)}&lines=${lines}${plain ? '&plain=1' : ''}`,
  );
}

export function fetchKeys(table = 'prefix') {
  return request<{ keys: KeyBinding[] }>(`/api/keys?table=${encodeURIComponent(table)}`);
}

export function wsUrl(path: string, params: Record<string, string | number> = {}) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  );
  if (TOKEN) qs.set('token', TOKEN);
  return `${proto}//${location.host}${path}?${qs.toString()}`;
}

/** サーバから push される tmux の状態を購読する */
export function useTmuxState() {
  const [state, setState] = useState<TmuxState | null>(null);
  const [connected, setConnected] = useState(false);
  /** 401。「セッションが 0 件」と区別が付かないと原因を見失うので分けて持つ */
  const [unauthorized, setUnauthorized] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (stopped) return;
      const ws = new WebSocket(wsUrl('/ws/events'));
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          // push には server（バージョン・prefix・ホームディレクトリ）が乗っていない。
          // 素朴に差し替えると初回の REST で得た情報が 1 秒で消えるので引き継ぐ
          if (msg.type === 'state') {
            setState((prev) => ({ ...(msg as TmuxState), server: prev?.server }));
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 1200);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    fetchState()
      .then((s) => {
        setState(s);
        setUnauthorized(false);
      })
      .catch((err) => setUnauthorized(err instanceof AuthError));

    return () => {
      stopped = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  const refresh = () => {
    wsRef.current?.readyState === WebSocket.OPEN &&
      wsRef.current.send(JSON.stringify({ type: 'refresh' }));
  };

  return { state, connected, unauthorized, refresh };
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
  return request<FileListing>(`/api/files?${new URLSearchParams({ pane, path })}`, { signal });
}
export function openFile(pane: string, path: string, root: string) {
  return request<{ url: string }>('/api/files/open', {
    method: 'POST', body: JSON.stringify({ pane, path, root }),
  });
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
export function fetchDesktopStatus(signal?: AbortSignal) {
  return request<DesktopStatus>('/api/desktop/status', { signal });
}

export async function measureDesktopRoundTrip(signal?: AbortSignal) {
  const start = performance.now();
  await request<{ ok: boolean }>('/api/desktop/ping', { signal, cache: 'no-store' });
  return Math.round(performance.now() - start);
}

export function readDesktopClipboard() {
  return request<{ text: string }>('/api/desktop/clipboard');
}
export function writeDesktopClipboard(text: string) {
  return request<{ ok: true }>('/api/desktop/clipboard', { method: 'POST', body: JSON.stringify({ text }) });
}

export interface RecentProject { name: string; cwd: string; sessionId: string; modified: number; summary: string }
export interface StartedProject { sessionId: string; windowId: string; paneId: string; cwd: string }
export interface StartProjectOptions {
  mode: 'new' | 'existing'; name?: string; parent?: string; dir?: string;
  template?: 'none' | 'node' | 'python'; agent?: 'claude' | 'codex' | 'shell';
  prompt?: string; resumeId?: string; remoteControl?: boolean;
}
export const recentProjects = (signal?: AbortSignal) => request<{ projects: RecentProject[] }>('/api/projects/recent', { signal });
export const startProject = (options: StartProjectOptions) => request<StartedProject>('/api/projects/start', { method: 'POST', body: JSON.stringify(options) });
export const remoteControl = (pane: string, connect = true) => request<{ url?: string; pending?: boolean }>('/api/claude/remote-control', { method: 'POST', body: JSON.stringify({ pane, connect }) });
export async function uploadFile(pane: string, path: string, root: string, file: File, signal?: AbortSignal) {
  const res = await fetch(withToken(`/api/files/upload?${new URLSearchParams({ pane, path, root, name: file.name })}`), {
    method: 'POST', body: file, signal, headers: { 'Content-Type': 'application/octet-stream', ...(TOKEN ? { 'x-tmux-web-token': TOKEN } : {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 413 ? '1ファイルは50MBまでです。' : body.error || 'アップロードできませんでした');
  return body as { name: string };
}
export const archiveFiles = (pane: string, path: string, root: string) => request<{ url: string }>('/api/files/archive', { method: 'POST', body: JSON.stringify({ pane, path, root }) });
export interface Approval { id: string; cmd: string; cwd: string; detail: string; attempt: number; expiresAt: number }
export const fetchApproval = (signal?: AbortSignal) => request<{ pending: Approval | null; secure: boolean }>('/api/approvals', { signal, cache: 'no-store' });
export const answerApproval = (id: string, password: string) => request('/api/approvals/answer', { method: 'POST', body: JSON.stringify({ id, password }) });
export const cancelApproval = (id: string) => request('/api/approvals/cancel', { method: 'POST', body: JSON.stringify({ id }) });
