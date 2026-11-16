import test from 'node:test';
import assert from 'node:assert/strict';
import { nextInputBar, numberSetting, reviveInputBar } from '../src/shared-setting';

test('the input bar setting carries over the old key bar switch', () => {
  assert.equal(reviveInputBar(null, () => 'true'), 'always', 'key bar on becomes 常に表示');
  assert.equal(reviveInputBar(null, () => 'false'), 'auto');
  assert.equal(reviveInputBar(null, () => null), 'auto');
  assert.equal(reviveInputBar('hidden', () => 'true'), 'hidden', 'a saved choice wins over the old switch');
  assert.equal(reviveInputBar('bogus', () => null), 'auto');
  assert.deepEqual(['auto', 'always', 'hidden'].map(m => nextInputBar(m as 'auto')), ['always', 'hidden', 'auto']);
});

test('number settings fall back to the default when the saved value is broken', () => {
  const font = numberSetting(13, 6, 28);
  assert.equal(font(15), 15);
  assert.equal(font(2), 13);
  assert.equal(font('15'), 13);
  assert.equal(font(null), 13);
  assert.equal(font(Number.NaN), 13);
});
