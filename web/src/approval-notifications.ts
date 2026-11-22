import type { Approval } from './api';

const tag = 'sudo-approval';
let handledId: string | null | undefined;

export const isApprovalId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(id);

export function approvalNotificationPermission(): NotificationPermission | 'unsupported' {
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone && window.isSecureContext && 'serviceWorker' in navigator && 'ServiceWorkerRegistration' in window
    && typeof ServiceWorkerRegistration.prototype.showNotification === 'function' && 'Notification' in window
    ? Notification.permission : 'unsupported';
}

export async function syncApprovalNotification(pending: Approval | null) {
  const id = pending && pending.expiresAt > Date.now() ? pending.id : null;
  if (handledId === id || approvalNotificationPermission() !== 'granted') return;
  try {
    const worker = await navigator.serviceWorker.getRegistration();
    if (!worker?.active) return;
    const notices = await worker.getNotifications({ tag });
    if (id && pending && pending.expiresAt > Date.now()) {
      if (!notices.some(notice => notice.data?.id === id)) {
        await worker.showNotification('sudo の承認待ち', {
          body: 'tmux web を開いて実行内容を確認してください。',
          icon: '/icon-192.png',
          tag,
          data: { id },
        });
      }
    } else {
      for (const notice of notices) notice.close();
    }
    handledId = id;
  } catch {
    // 通知が使えない環境でも、アプリ内の承認は続ける。
  }
}
