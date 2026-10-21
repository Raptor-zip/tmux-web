import type { TmuxState } from './types';

export interface Device {
  id: string;
  name: string;
  local: boolean;
  url?: string;
  hasToken?: boolean;
  connected?: boolean;
  error?: string;
  server?: TmuxState['server'];
  serverPid?: number | null;
}
export const deviceOf = (id?: string | null): string => id?.includes('~') ? id.split('~')[0] : 'local';
export const unscoped = (id: string): string => id.includes('~') ? id.slice(id.indexOf('~') + 1) : id;
export const scoped = (device: string, id: string): string => device === 'local' ? id : `${device}~${id}`;
export const devicePath = (device: string, path: string): string => device === 'local' ? path : `/api/devices/${encodeURIComponent(device)}/proxy${path}`;

export function scopeState(device: Device, state: TmuxState): TmuxState {
  const id = (value: string) => scoped(device.id, value);
  return {
    ...state,
    sessions: state.sessions.map(s => ({ ...s, id: id(s.id) })),
    windows: state.windows.map(w => ({ ...w, id: id(w.id), sessionId: id(w.sessionId) })),
    panes: state.panes.map(p => ({ ...p, id: id(p.id), windowId: id(p.windowId), sessionId: id(p.sessionId) })),
  };
}

/** 操作対象だけを変換する。コマンド本文・パス・名前には触れない。 */
export function routeAction(params: Record<string, unknown>, fallback = 'local') {
  const fields = ['target', 'source', 'session', 'anchor'];
  const ids = fields.flatMap(key => typeof params[key] === 'string' ? [params[key] as string] : []);
  if (Array.isArray(params.targets)) ids.push(...params.targets as string[]);
  const devices = new Set(ids.map(deviceOf));
  if (devices.size > 1) throw new Error('デバイスをまたぐ移動・結合はできません。表示するタブは別デバイスの隣へ移動できます。');
  const device = [...devices][0] || (typeof params.deviceId === 'string' ? params.deviceId : fallback);
  const result = { ...params };
  delete result.deviceId;
  for (const key of fields) if (typeof result[key] === 'string') result[key] = unscoped(result[key] as string);
  if (Array.isArray(result.targets)) result.targets = result.targets.map(unscoped);
  return { device, params: result };
}
