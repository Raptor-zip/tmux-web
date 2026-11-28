const assert = require('node:assert/strict');

module.exports = async function checkClipboardSync(page, transports) {
  const context = page.context();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  let remote = '接続前の接続先';
  let reads = 0;
  let pasteReply;
  const writes = [];
  const local = value => page.evaluate(text => navigator.clipboard.writeText(text), value);
  const waitForLocal = value => page.waitForFunction(async text => await navigator.clipboard.readText() === text, value);
  await local('接続前のブラウザ');
  await page.route(/\/desktop\/clipboard$/, async route => {
    if (route.request().method() === 'POST') {
      const text = route.request().postDataJSON().text;
      writes.push(text);
      if (pasteReply) await pasteReply;
      remote = text;
      return route.fulfill({ json: { ok: true } });
    }
    reads++;
    return route.fulfill({ json: { text: remote } });
  });
  return async () => {
    const dialog = page.getByRole('dialog', { name: 'リモートデスクトップ', exact: true });
    const canvas = dialog.locator('canvas');
    await dialog.locator('.desktop-connection-status.is-connected').waitFor();
    await canvas.focus();
    const waitFor = async predicate => {
      for (let i = 0; i < 80; i++) {
        if (predicate()) return;
        await page.waitForTimeout(50);
      }
      assert.fail('Clipboard sync timed out');
  };
  await waitFor(() => reads >= 2);
  assert.deepEqual(writes, [], 'old browser contents are the baseline');
  await waitForLocal('接続前のブラウザ');

  remote = '接続先でコピー\n二行目\t✅';
  await waitForLocal(remote);
  assert.deepEqual(writes, [], 'received text is not sent back');
  await local('ブラウザでコピー\n二行目\t✅');
  await waitFor(() => remote === 'ブラウザでコピー\n二行目\t✅');
  await waitForLocal(remote);
  assert.deepEqual(writes, [remote]);

  // A native paste must upload the current text before sending V to the remote screen.
  const transport = transports.findLast(item => !item.closed);
  const before = transport.keys.length;
  await local('即時貼り付け');
  await page.keyboard.press('Control+v');
  await waitFor(() => transport.keys.slice(before).some(key => key.down && key.key === 0x76));
  assert.equal(remote, '即時貼り付け');

  // When background reads are denied, Ctrl+V still works through the native paste event.
    await context.clearPermissions();
  await context.grantPermissions(['clipboard-write']);
    assert.notEqual(await page.evaluate(async () => (await navigator.permissions.query({ name: 'clipboard-read' })).state), 'granted');
    let reply;
    pasteReply = new Promise(resolve => { reply = resolve; });
    const beforeDeniedPaste = transport.keys.length;
    const sentPasteKey = () => transport.keys.slice(beforeDeniedPaste).some(key => key.down && key.key === 0x76);
  await local('読み取り権限なしの貼り付け');
  await page.keyboard.press('Control+v');
    try {
      await waitFor(() => writes.includes('読み取り権限なしの貼り付け'));
      await page.waitForTimeout(200);
      assert.equal(sentPasteKey(), false, 'waits for the X11 clipboard write before sending V');
    } finally { reply(); pasteReply = undefined; }
    await waitFor(sentPasteKey);

  await dialog.getByRole('button', { name: '画面の操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '見るだけ', exact: true }).click();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await canvas.focus();
  const count = writes.length;
  await local('表示専用のブラウザ');
  const previousReads = reads;
  await waitFor(() => reads >= previousReads + 2);
  assert.equal(writes.length, count, 'view-only mode never writes to the X11 clipboard');
  remote = '表示専用の接続先';
  await waitForLocal(remote);
  console.log('remote clipboard sync: both directions, native paste, and view-only mode passed');
  };
};
