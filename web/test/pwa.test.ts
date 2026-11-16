import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function worker(fetcher: () => Promise<Response>) {
  const handlers = new Map<string, (event: unknown) => void>();
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self: { location: { origin: 'https://tmux.example' }, addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler) },
    URL, Response, fetch: fetcher,
  });
  return (path: string, mode = 'navigate', method = 'GET') => {
    let response: Promise<Response> | null = null;
    handlers.get('fetch')!({ request: { url: 'https://tmux.example' + path, method, mode }, respondWith: (value: Promise<Response>) => { response = value; } });
    return response;
  };
}

test('offline app launch gives a reconnect page while API and private files remain network-only', async () => {
  const handle = worker(async () => { throw new Error('offline'); });
  const response = await handle('/')!;
  assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(await response.text(), /Tailscale/);
  for (const path of ['/api/state', '/api/files', '/files/content?ticket=private', '/ws/terminal']) assert.equal(handle(path), null);
  assert.equal(handle('/', 'cors'), null); assert.equal(handle('/', 'navigate', 'POST'), null);
});

test('service worker never substitutes an offline or cached page for an authentication failure', async () => {
  const response = await worker(async () => new Response('denied', { status: 401 }))('/')!;
  assert.equal(response.status, 401); assert.equal(await response.text(), 'denied');
});

test('the install hint toast appears once, and only when the browser can install the app', async () => {
  const { takeInstallHint, INSTALL_HINT_KEY } = await import('../src/pwa');
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  assert.equal(takeInstallHint(storage, { installed: false, promptable: false }), false, 'no hint when the browser cannot prompt');
  assert.equal(takeInstallHint(storage, { installed: true, promptable: true }), false, 'no hint inside the installed app');
  assert.equal(store.has(INSTALL_HINT_KEY), false);
  assert.equal(takeInstallHint(storage, { installed: false, promptable: true }), true, 'first chance shows the hint');
  assert.equal(takeInstallHint(storage, { installed: false, promptable: true }), false, 'never shown twice');
  assert.equal(takeInstallHint(null, { installed: false, promptable: true }), false, 'no storage, no hint');
  const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };
  assert.equal(takeInstallHint(throwing, { installed: false, promptable: true }), false);
});
