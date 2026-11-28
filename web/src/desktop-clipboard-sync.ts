import { readDesktopClipboard, writeDesktopClipboard } from './api';

const POLL_MS = 750;

export function startDesktopClipboardSync(
  device: string,
  active: () => boolean,
  canSend: () => boolean,
  receive: (text: string) => void,
  permissionChanged: (prompt: boolean) => void,
) {
  const controller = new AbortController();
  const { signal } = controller;
  const clipboard = navigator.clipboard;
  let readPermission: PermissionStatus | undefined;
  const reportPermission = () => permissionChanged(readPermission?.state === 'prompt');
  // Querying permission does not prompt. Explicit paste still works without it.
  void navigator.permissions?.query({ name: 'clipboard-read' as PermissionName })
    .then(status => {
      if (signal.aborted) return;
      readPermission = status;
      status.addEventListener('change', reportPermission, { signal });
      reportPermission();
    }).catch(() => {});

  let remote: string | undefined;
  let local: string | undefined;
  let revision = 0;
  let writes = Promise.resolve();
  let pending = 0;
  let timer: ReturnType<typeof setTimeout>;

  function send(text: string, fromBrowser: boolean, stillCurrent = canSend) {
    revision++;
    pending++;
    const result = writes.then(async () => {
      if (signal.aborted || !stillCurrent()) return false;
      await writeDesktopClipboard(text, device, AbortSignal.any([signal, AbortSignal.timeout(5000)]));
      remote = text;
      if (fromBrowser) local = text;
      return !signal.aborted;
    }).finally(() => { pending--; });
    writes = result.then(() => {}, () => {});
    return result;
  }

  async function poll() {
    const version = revision;
    const current = () => !signal.aborted && active() && !pending && version === revision;
    try {
      if (!current()) return;
      const { text: remoteText } = await readDesktopClipboard(device, AbortSignal.any([signal, AbortSignal.timeout(5000)]));
      if (!current()) return;
      const canRead = canSend() && readPermission?.state === 'granted';
      if (!canRead) local = undefined;
      const localText = canRead
        ? await clipboard?.readText().catch(() => undefined)
        : undefined;
      if (!current()) return;

      const remoteChanged = remote !== undefined && remoteText !== remote;
      const localChanged = local !== undefined && localText !== undefined && localText !== local;
      remote = remoteText;
      if (localText !== undefined && (!localChanged || !localText || localText === remoteText)) local = localText;

      if (localChanged && localText && localText !== remoteText) {
        await send(localText, true, () => active() && canSend());
      } else if (remoteChanged && remoteText && remoteText !== localText) {
        try {
          if (!clipboard?.writeText) throw new Error();
          await clipboard.writeText(remoteText);
          if (current()) local = remoteText;
        } catch {
          if (current()) receive(remoteText);
        }
      }
    } catch {
      // The X11 selection may be temporarily unavailable. Try again on the next poll.
    } finally {
      if (!signal.aborted) timer = setTimeout(() => void poll(), POLL_MS);
    }
  }

  void poll();
  return {
    send,
    async requestPermission() {
      const text = await clipboard.readText();
      if (!signal.aborted) { revision++; local = text; }
    },
    copied(text: string) { revision++; local = text; remote = text; },
    resetLocal() { revision++; local = undefined; },
    stop() { controller.abort(); clearTimeout(timer); },
  };
}
