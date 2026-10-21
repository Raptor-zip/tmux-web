export function registerAppWorker() {
  if (!import.meta.env.PROD || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  // API・端末・ファイルはキャッシュしない。接続不可時の案内だけを提供する。
  void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
    // 登録に失敗しても通常のオンライン画面は利用できる。
  });
}
