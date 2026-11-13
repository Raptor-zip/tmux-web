export const isWorkspaceKey = (key: string) => /^tw\.(?:desktops|(?:layout|focusedLeaf|serverPid|device)(?:\.[a-zA-Z0-9_-]{1,80})?)$/.test(key);
type Values = Record<string, string>;
type Change = { before: string | null; after: string | null };
type Patch = { id: string; changes: Record<string, Change>; seed?: boolean; sent?: boolean };
export interface WorkspaceStatus { ready: boolean; connected: boolean; error: string; remoteAt: number }
const initialDesktops = JSON.stringify({ activeId: 'main', items: [{ id: 'main', name: 'デスクトップ1' }] });
const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null);
const apply = (values: Values, changes: Record<string, Change>) => {
  for (const [key, { after }] of Object.entries(changes)) {
    if (after === null) delete values[key]; else values[key] = after;
  }
};

/** Optimistic local edits, atomic compare-and-set patches, and authoritative reconnect snapshots. */
export function createWorkspaceStore({ open, storage, prepareSeed = values => values }: { open(): WebSocket; storage?: Storage; prepareSeed?(values: Values): Values }) {
  let values: Values = {};
  try {
    for (let i = 0; storage && i < storage.length; i++) {
      const key = storage.key(i)!;
      if (isWorkspaceKey(key)) {
        const raw = storage.getItem(key);
        if (raw !== null) { JSON.parse(raw); values[key] = raw; }
      }
    }
  } catch { /* Storage is only a cache; sync also works without it. */ }
  let status: WorkspaceStatus = { ready: false, connected: false, error: '', remoteAt: 0 };
  const listeners = new Set<() => void>();
  let queue: Patch[] = [];
  let draft: Record<string, Change> = {};
  let sequence = 0;
  let running = false;
  let hydrated = false;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let responseTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let revision = -1;
  const emit = () => { for (const listener of listeners) listener(); };
  const publish = (next: Partial<WorkspaceStatus>) => { status = { ...status, ...next }; emit(); };
  const cache = () => {
    try {
      const oldKeys: string[] = [];
      for (let i = 0; storage && i < storage.length; i++) oldKeys.push(storage.key(i)!);
      for (const key of oldKeys) if (isWorkspaceKey(key) && !Object.hasOwn(values, key)) storage?.removeItem(key);
      for (const [key, value] of Object.entries(values)) storage?.setItem(key, value);
    } catch { /* private mode / quota */ }
  };
  const seal = () => {
    if (Object.keys(draft).length) queue.push({ id: String(++sequence), changes: draft });
    draft = {};
  };
  const send = () => {
    if (!hydrated || !socket || socket.readyState !== socket.OPEN) return;
    const patch = queue[0];
    if (!patch || patch.sent) return;
    patch.sent = true;
    try { socket.send(JSON.stringify({ type: 'workspace-patch', ...patch })); }
    catch { reconnectLater(); }
  };
  const retire = () => {
    clearTimeout(responseTimer); responseTimer = undefined;
    clearTimeout(heartbeat); heartbeat = undefined;
    hydrated = false;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close(); socket = undefined;
    }
    for (const patch of queue) patch.sent = false;
  };
  const reconnectLater = (error = '配置の同期を再接続中…') => {
    retire();
    publish({ connected: false, error });
    clearTimeout(retry);
    if (running) retry = setTimeout(connect, 2500);
  };
  const probe = () => {
    if (!socket || socket.readyState !== socket.OPEN) return;
    try {
      socket.send(JSON.stringify({ type: 'refresh' }));
      responseTimer ??= setTimeout(() => reconnectLater(), 10000);
    } catch { reconnectLater(); }
  };
  const connect = () => {
    clearTimeout(retry); retire();
    if (!running) return;
    publish({ connected: false });
    try { socket = open(); } catch { reconnectLater(); return; }
    responseTimer = setTimeout(() => reconnectLater(), 10000);
    socket.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.type !== 'workspace' || typeof message.initialized !== 'boolean'
          || !Number.isSafeInteger(message.revision) || !message.values || typeof message.values !== 'object'
          || Array.isArray(message.values) || !Object.entries(message.values).every(([key, value]) => isWorkspaceKey(key) && typeof value === 'string')) return;
      clearTimeout(responseTimer); responseTimer = undefined;
      clearTimeout(heartbeat); heartbeat = setTimeout(probe, 30000);
      // A new socket can reconnect to a restarted server; only compare revisions within this connection.
      if (hydrated && message.revision < revision) return;
      revision = message.revision;
      hydrated = true;
      seal();
      let conflict = !!message.conflict;
      if (message.ack) queue = queue.filter(patch => patch.id !== message.ack);
      if (!message.initialized && !queue.some(patch => patch.seed)) {
        const seed = prepareSeed({ ...values, 'tw.desktops': values['tw.desktops'] || initialDesktops });
        queue.unshift({ id: String(++sequence), seed: true, changes: Object.fromEntries(Object.entries(seed).map(([key, after]) => [key, { before: null, after }])) });
      }
      const next = { ...message.values } as Values;
      queue = queue.filter(patch => {
        if (Object.entries(patch.changes).every(([key, change]) => same(next[key], change.after))) return false;
        if (!Object.entries(patch.changes).every(([key, change]) => same(next[key], change.before))) { conflict = true; return false; }
        apply(next, patch.changes); return true;
      });
      const remoteAt = JSON.stringify(next) !== JSON.stringify(values) ? Date.now() : status.remoteAt;
      values = next; cache();
      publish({ ready: status.ready || message.initialized, connected: message.initialized, remoteAt,
        error: message.error || (conflict ? '同時変更があったため、最新の配置を表示しました' : '') });
      send();
    };
    socket.onclose = () => reconnectLater();
    socket.onerror = () => reconnectLater();
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getStatus: () => status,
    get: (key: string) => values[key] ?? null,
    set(key: string, after: string | null) {
      if (!isWorkspaceKey(key)) throw new Error('Invalid workspace key');
      const before = values[key] ?? null;
      if (same(before, after)) return;
      draft[key] = { before: Object.hasOwn(draft, key) ? draft[key].before : before, after };
      if (same(draft[key].before, after)) delete draft[key];
      apply(values, { [key]: { before, after } }); cache(); emit();
      queueMicrotask(() => { seal(); send(); });
    },
    start() { if (!running) { running = true; connect(); } },
    reconnect() { if (running) connect(); },
    stop() { running = false; clearTimeout(retry); retire(); publish({ connected: false }); },
  };
}
