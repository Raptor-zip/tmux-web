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
