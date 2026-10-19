import test from 'node:test';
import assert from 'node:assert/strict';
import { losslessEncodings } from '../src/vendor/lossless-encodings';

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
