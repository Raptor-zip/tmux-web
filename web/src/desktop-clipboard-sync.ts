import { readDesktopClipboard, writeDesktopClipboard } from './api';

const POLL_MS = 750;
let requestedReadPermission = false;

export function clipboardPageFocused() {
  return document.visibilityState === 'visible' && document.hasFocus();
}

export function startDesktopClipboardSync(
  device: string,
  active: () => boolean,
  canSend: () => boolean = active,
  receive?: (text: string) => void,
) {
  const controller = new AbortController();
  const { signal } = controller;
  const clipboard = navigator.clipboard;
  let readPermission: PermissionStatus | undefined;
  void navigator.permissions?.query({ name: 'clipboard-read' as PermissionName })
    .then(status => {
      readPermission = status;
    }).catch(() => {});

  let remote: string | undefined;
  let local: string | undefined;
  let revision = 0;
  let writes = Promise.resolve();
  let pending = 0;
  let timer: ReturnType<typeof setTimeout>;

  function requestPermission(event: Event) {
    if (!event.isTrusted || requestedReadPermission || readPermission?.state !== 'prompt' ||
        !clipboard?.readText || !active() || !canSend()) return;
    requestedReadPermission = true;
    // Ask through the browser on the first interaction with the active device.
    void clipboard.readText().then(text => {
      if (!signal.aborted && active() && canSend()) { revision++; local = text; }
    }).catch(() => {});
  }
  window.addEventListener('click', requestPermission, { capture: true, signal });
  window.addEventListener('keydown', requestPermission, { capture: true, signal });

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
          if (current()) receive?.(remoteText);
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
    copied(text: string) { revision++; local = text; remote = text; },
    reset() { revision++; local = undefined; remote = undefined; },
    stop() { controller.abort(); clearTimeout(timer); },
  };
}
