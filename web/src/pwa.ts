import { useSyncExternalStore } from 'react';

export function registerAppWorker() {
  if (!import.meta.env.PROD || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  // API・端末・ファイルはキャッシュしない。接続不可時の案内だけを提供する。
  void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
    // 登録に失敗しても通常のオンライン画面は利用できる。
  });
}

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * 『アプリとして追加』の状態。上バーのボタンをやめたので、『表示と接続』・パレット・初回の案内トーストの
 * どこからでも同じ状態を見られるよう、画面に 1 つだけ持つ。
 * beforeinstallprompt は読み込み直後に 1 回しか来ないので、描画を待たずに main.tsx から watchInstall で受ける。
 */
export interface InstallState {
  /** すでにアプリとして開いている（または追加した） */
  installed: boolean;
  /** ブラウザの追加ダイアログを出せる（beforeinstallprompt を受け取った） */
  promptable: boolean;
  /** ブラウザのメニューから追加する手順を出している */
  help: boolean;
  busy: boolean;
  error: string;
}

let prompt: InstallPrompt | null = null;
let state: InstallState = { installed: false, promptable: false, help: false, busy: false, error: '' };
const listeners = new Set<() => void>();
const set = (next: Partial<InstallState>) => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};

export function watchInstall() {
  const media = window.matchMedia('(display-mode: standalone)');
  set({ installed: media.matches });
  const done = () => { prompt = null; set({ installed: true, promptable: false, help: false }); };
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    prompt = event as InstallPrompt;
    set({ promptable: true });
  });
  window.addEventListener('appinstalled', done);
  media.addEventListener('change', () => { if (media.matches) done(); });
}

/** 追加する。ブラウザのダイアログを出せないときは、ブラウザのメニューから追加する手順を出す */
export async function requestInstall() {
  if (!prompt) { set({ help: true, error: '' }); return; }
  const current = prompt;
  set({ busy: true, error: '' });
  try {
    await current.prompt();
    if ((await current.userChoice).outcome === 'accepted') set({ installed: true });
  } catch {
    set({ help: true, error: 'ブラウザのメニューからアプリをインストールしてください。' });
  } finally {
    prompt = null;
    set({ busy: false, promptable: false });
  }
}

export const closeInstallHelp = () => set({ help: false });

export function useInstallState() {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => state,
  );
}

export const INSTALL_HINT_KEY = 'tw.installHint';
/**
 * 『アプリとして追加できます』の案内を、いま出すか。出すのは一度だけで、出すと決めたらその場で覚える。
 * アプリとして開いているとき、ブラウザが追加を受け付けないときは出さない（『表示と接続』からは追加できる）。
 */
export function takeInstallHint(storage: Pick<Storage, 'getItem' | 'setItem'> | null, install: Pick<InstallState, 'installed' | 'promptable'>): boolean {
  if (install.installed || !install.promptable || !storage) return false;
  try {
    if (storage.getItem(INSTALL_HINT_KEY)) return false;
    storage.setItem(INSTALL_HINT_KEY, '1');
    return true;
  } catch {
    return false;
  }
}
