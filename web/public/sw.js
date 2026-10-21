// ネットワーク認証を毎回通す。私的な端末出力・API・ファイルをCache Storageへ保存しない。
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || event.request.mode !== 'navigate' || url.origin !== self.location.origin || url.pathname !== '/') return;
  event.respondWith(fetch(event.request).catch(() => new Response(`<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>tmux web · 接続を確認</title>
<style>body{margin:0;background:#1e1e1e;color:#ccc;font:16px/1.7 system-ui,sans-serif;display:grid;min-height:100dvh;place-items:center}main{max-width:32rem;padding:28px}h1{font-size:22px;color:white}a{display:inline-block;color:white;background:#007acc;padding:10px 20px;border-radius:5px;text-decoration:none}p{color:#aaa}</style>
<main><h1>サーバーに接続できません</h1><p>Tailscaleへの接続と、配信元PCが起動していることを確認してください。</p><p>実行中の処理は、各デバイスのtmux上で継続します。</p><a href="/">再接続する</a></main></html>`, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" },
  })));
});
