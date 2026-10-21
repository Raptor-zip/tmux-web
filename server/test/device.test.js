import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceIdentity, devicePng, deviceSvg } from '../src/device.js';

test('device branding is stable and differs across hosts', () => {
  const a = deviceIdentity('workstation-a');
  assert.deepEqual(a, deviceIdentity('workstation-a'));
  const b = deviceIdentity('workstation-b');
  assert.notEqual(a.color, b.color);
  assert.notEqual(deviceSvg(a), deviceSvg(b));
  assert.match(a.color, /^#[0-9a-f]{6}$/);
  assert.match(a.accent, /^#[0-9a-f]{6}$/);
  assert.ok(!deviceSvg(deviceIdentity('<script>')).includes('<script>'));
  for (const size of [180,192,512]) {
    const png = devicePng(a, size);
    assert.equal(png.subarray(1,4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.notDeepEqual(png, devicePng(b, size));
  }
});

test('PWA manifest has a stable identity, clean launch URL and valid install icons', async t => {
  const { default: express } = await import('express');
  const { once } = await import('node:events');
  const { installDevice } = await import('../src/device.js');
  const app = express(); installDevice(app);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/manifest.webmanifest?device=old-fingerprint');
  assert.match(response.headers.get('content-type'), /application\/manifest\+json/);
  const manifest = await response.json();
  assert.equal(manifest.id, '/'); assert.equal(manifest.start_url, '/'); assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone'); assert.ok(manifest.name);
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(icon => icon.sizes === `${size}x${size}`);
    assert.ok(icon); const png = Buffer.from(await (await fetch(base + icon.src)).arrayBuffer());
    assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
  }
});
