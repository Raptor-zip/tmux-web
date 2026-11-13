import { useCallback, useMemo, useSyncExternalStore, type SetStateAction } from 'react';
import { migrate } from './layout';
import { restoreDesktops } from './desktops';
import { createWorkspaceStore } from './workspace-sync';

let storage: Storage | undefined;
try { storage = window.localStorage; } catch { /* Private mode. */ }
export const workspaceStore = createWorkspaceStore({
  storage,
  prepareSeed(values) {
    const next: Record<string, string> = { ...values, 'tw.desktops': JSON.stringify(restoreDesktops(JSON.parse(values['tw.desktops'] || 'null'))) };
    for (const key of Object.keys(next)) if (/^tw\.layout(?:\.|$)/.test(key)) next[key] = JSON.stringify(migrate(JSON.parse(next[key])));
    return next;
  },
  open: () => new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/workspace`),
});
export const useWorkspaceStatus = () => useSyncExternalStore(workspaceStore.subscribe, workspaceStore.getStatus);

export function useWorkspaceValue<T>(key: string, initial: T, revive?: (raw: unknown) => T) {
  const raw = useSyncExternalStore(workspaceStore.subscribe, () => workspaceStore.get(key));
  const parse = (value: string | null): T => {
    try { return value === null ? initial : revive ? revive(JSON.parse(value)) : JSON.parse(value) as T; }
    catch { return initial; }
  };
  const set = useCallback((action: SetStateAction<T>) => {
    const previous = parse(workspaceStore.get(key));
    const next = typeof action === 'function' ? (action as (value: T) => T)(previous) : action;
    workspaceStore.set(key, JSON.stringify(next));
  }, [key]);
  const value = useMemo(() => parse(raw), [raw, key]);
  return [value, set] as const;
}
