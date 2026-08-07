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
          if (msg.type === 'state') setState(msg as TmuxState);
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
