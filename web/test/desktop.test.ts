import test from 'node:test';
import assert from 'node:assert/strict';
import { losslessEncodings, desktopEncodings } from '../src/vendor/lossless-encodings';
import { desktopPresets, parseDesktopSettings } from '../src/desktop-settings';

test('remote desktop negotiates lossless encodings without JPEG quality hints or video', () => {
  for (const depth of [8, 24]) {
    const encodings = losslessEncodings(depth, 2);
    assert.ok(encodings.includes(0), 'raw fallback');
    assert.ok(encodings.includes(-223), 'screen size changes');
    assert.ok(encodings.includes(0xc0a1e5ce), 'Unicode clipboard');
    for (const forbidden of [7, -260, 21, 50, -32, -31, -30, -29, -28, -27, -26, -25, -24, -23]) {
      assert.ok(!encodings.includes(forbidden), `lossy encoding/quality hint ${forbidden}`);
    }
  }
  assert.ok(losslessEncodings(24, 2).includes(16), 'ZRLE preferred');
  assert.ok(losslessEncodings(24, 2).includes(-239), 'local cursor');
});

test('desktop settings recover from stale or corrupt saved values', () => {
  const defaults = parseDesktopSettings(null);
  assert.equal(defaults.lossless, false);
  assert.deepEqual(parseDesktopSettings({ quality: 10, compression: -1, scale: '500', interval: '0', lossless: 'yes' }), defaults);
  assert.deepEqual(parseDesktopSettings({ quality: 1.5, compression: NaN }), defaults);
  for (const preset of Object.values(desktopPresets)) {
    const { label, ...settings } = preset;
    assert.deepEqual(parseDesktopSettings(settings), settings, label);
  }
  assert.equal(parseDesktopSettings({ quality: 0, compression: 0 }).quality, 0);
  assert.equal(parseDesktopSettings({ quality: 0, compression: 0 }).compression, 0);
});

test('JPEG mode prefers Tight and negotiates the chosen quality; lossless remains exact', () => {
  for (let quality = 0; quality <= 9; quality++) {
    const encodings = desktopEncodings(24, 1, quality);
    assert.equal(encodings[1], 7);
    assert.ok(encodings.includes(-32 + quality));
    assert.ok(encodings.includes(-255));
    assert.ok(!encodings.includes(0x48323634), 'H.264 is not advertised');
  }
  assert.deepEqual(desktopEncodings(24, 1, null), losslessEncodings(24, 1));
  assert.deepEqual(desktopEncodings(8, 1, 6), losslessEncodings(8, 1));
});
