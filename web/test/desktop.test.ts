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

test('all desktop modes use client-paced updates to avoid an old-frame backlog', () => {
  for (const quality of [null, 3, 6, 8, 9]) {
    assert.ok(!desktopEncodings(24, 0, quality).includes(-313));
  }
  assert.equal(desktopPresets.lan.scale, '1');
  assert.equal(desktopPresets.lan.interval, '16');
  assert.equal(desktopPresets.lan.compression, 0);
});

test('Alt+digit counts the visible tab strip: the focused panel when split, the whole workspace in single-panel view', async () => {
  const { makeLeaf, makeTab, visibleTabOrder, stepInOrder } = await import('../src/layout');
  const a1 = makeTab('s', '@1'), a2 = makeTab('s', '@2');
  const b1 = makeTab('s', '@3'), b2 = makeTab('s', '@4'), b3 = makeTab('s', '@5');
  const left = makeLeaf([a1, a2]);
  const right = makeLeaf([b1, b2, b3]);
  const tree = { type: 'split' as const, id: 'sp', dir: 'row' as const, ratio: 0.5, a: left, b: right };
  const ids = (tabs: { id: string }[]) => tabs.map(t => t.id);

  // 分割表示：入力先のパネルの中だけ
  assert.deepEqual(ids(visibleTabOrder(tree, right, false)), ids([b1, b2, b3]));
  assert.deepEqual(ids(visibleTabOrder(tree, left, false)), ids([a1, a2]));
  // 1 パネル表示：ワークスペース全体をパネル順に（タブ列に並ぶ順と同じ）
  assert.deepEqual(ids(visibleTabOrder(tree, right, true)), ids([a1, a2, b1, b2, b3]));
  // パネルが 1 つなら 1 パネル表示でも同じ
  assert.deepEqual(ids(visibleTabOrder(left, left, true)), ids([a1, a2]));
  // フォーカスが無い・配置が無い
  assert.deepEqual(visibleTabOrder(tree, null, false), []);
  assert.deepEqual(visibleTabOrder(null, left, true), []);

  // Alt+[ ]：並びの中で送る。端は反対側へ回り、1 パネル表示ではパネルをまたぐ
  const all = visibleTabOrder(tree, right, true);
  assert.equal(stepInOrder(all, a2.id, 1)?.id, b1.id);
  assert.equal(stepInOrder(all, b1.id, -1)?.id, a2.id);
  assert.equal(stepInOrder(all, b3.id, 1)?.id, a1.id);
  assert.equal(stepInOrder(all, a1.id, -1)?.id, b3.id);
  assert.equal(stepInOrder([a1], a1.id, 1), null);
  assert.equal(stepInOrder([], null, 1), null);
});

test('Alt+J cycles through waiting terminals after the current one', async () => {
  const { nextWaiting } = await import('../src/status');
  assert.equal(nextWaiting([], '@1'), null);
  assert.equal(nextWaiting(['@2', '@5'], null), '@2');
  assert.equal(nextWaiting(['@2', '@5'], '@9'), '@2');
  assert.equal(nextWaiting(['@2', '@5'], '@2'), '@5');
  assert.equal(nextWaiting(['@2', '@5'], '@5'), '@2');
  assert.equal(nextWaiting(['@2'], '@2'), null);
});
