import type { TmuxState } from './types';

export interface StateRecord {
  state?: TmuxState;
  connected: boolean;
  error?: string;
}

function isState(value: unknown): value is TmuxState {
  return !!value && typeof value === 'object'
    && Array.isArray((value as TmuxState).sessions)
    && Array.isArray((value as TmuxState).windows)
    && Array.isArray((value as TmuxState).panes);
}

/** One device's state stream, including its REST metadata and reconnect lifecycle. */
export function subscribeState({ open, read, update, onError }: {
  open(): WebSocket;
  read(signal: AbortSignal): Promise<TmuxState>;
  update(record: StateRecord): void;
  onError?(error: unknown): 'disconnect' | void;
}) {
  let stopped = false;
  let latest: TmuxState | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let cleanup = () => {};
  let requestRefresh = () => {};
  const publish = (connected: boolean, error = '') => update({ state: latest, connected, error });

  const start = () => {
    if (stopped) return;
    clearTimeout(retry);
    cleanup();
    publish(false, '接続中…');
    let active = true;
    let receivedStream = false;
    let readSucceeded = false;
    const controller = new AbortController();
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let readTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setTimeout> | undefined;
    let responseTimer: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket | null = null;
    const current = () => active && !stopped;
    cleanup = () => {
      active = false;
      requestRefresh = () => start();
      clearTimeout(connectTimer);
      clearTimeout(readTimer);
      clearTimeout(heartbeat);
      clearTimeout(responseTimer);
      controller.abort();
      if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        ws.close();
      }
    };
    const fail = (message = '切断・再接続中') => {
      if (!current()) return;
      cleanup();
      publish(false, message);
      retry = setTimeout(start, 2500);
    };
    requestRefresh = () => {
      if (!current()) return;
      if (!ws || ws.readyState !== ws.OPEN) { start(); return; }
      try {
        ws.send(JSON.stringify({ type: 'refresh' }));
        // Repeated manual refreshes must not extend an unanswered request.
        responseTimer ??= setTimeout(() => fail('応答がありません。再接続中…'), 10000);
      } catch { fail(); }
    };
    try { ws = open(); }
    catch (error) {
      onError?.(error);
      fail('接続できません。再接続中…');
      return;
    }
    connectTimer = setTimeout(() => fail('接続がタイムアウトしました。再接続中…'), 10000);
    ws.onopen = () => {
      if (!current()) return;
      clearTimeout(connectTimer);
      if (readSucceeded) publish(true);
      requestRefresh();
    };
    ws.onmessage = event => {
      if (!current()) return;
      try {
        const message = JSON.parse(event.data);
        if (message?.type !== 'state' || !isState(message)) return;
        receivedStream = true;
        latest = { ...message, server: message.server ?? latest?.server };
        clearTimeout(responseTimer);
        responseTimer = undefined;
        clearTimeout(heartbeat);
        heartbeat = setTimeout(requestRefresh, 30000);
        publish(true);
      } catch { /* Ignore malformed frames without satisfying the heartbeat. */ }
    };
    ws.onclose = () => fail();
    ws.onerror = () => fail();
    readTimer = setTimeout(() => controller.abort(), 10000);
    void read(controller.signal).then(state => {
      if (!current() || controller.signal.aborted) return;
      if (!isState(state)) throw new Error('接続先から正しい端末情報を取得できませんでした');
      readSucceeded = true;
      // A delayed initial snapshot must not roll back newer stream contents.
      latest = receivedStream && latest ? { ...latest, server: state.server ?? latest.server } : state;
      publish(ws!.readyState === ws!.OPEN);
    }).catch(error => {
      if (!current()) return;
      if (onError?.(error) === 'disconnect') { fail((error as Error).message); return; }
      if (!receivedStream) publish(false, controller.signal.aborted ? '端末情報の取得がタイムアウトしました' : (error as Error).message);
    }).finally(() => clearTimeout(readTimer));
  };

  start();
  return {
    refresh() { requestRefresh(); },
    reconnect() { start(); },
    dispose() { stopped = true; clearTimeout(retry); cleanup(); },
  };
}
