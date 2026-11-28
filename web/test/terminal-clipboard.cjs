const assert = require('node:assert/strict');

module.exports = async function prepareTerminalClipboard(page) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    // Report a fresh site's permission state while using Chromium's real clipboard.
    const query = navigator.permissions.query.bind(navigator.permissions);
    const readText = navigator.clipboard.readText.bind(navigator.clipboard);
    const status = { state: 'prompt' };
    window.clipboardPromptRequests = 0;
    navigator.permissions.query = permission => permission.name === 'clipboard-read' ? Promise.resolve(status) : query(permission);
    navigator.clipboard.readText = () => {
      if (status.state === 'prompt') {
        window.clipboardPromptRequests++;
        status.state = 'granted';
      }
      return readText();
    };
  });
  const remote = { local: 'ローカルの初期値', spark: 'Spark の初期値' };
  const reads = { local: 0, spark: 0 };
  const writes = [];
  await page.route(/\/desktop\/clipboard$/, async route => {
    const device = new URL(route.request().url()).pathname.includes('/devices/spark/') ? 'spark' : 'local';
    if (route.request().method() === 'POST') {
      remote[device] = route.request().postDataJSON().text;
      writes.push({ device, text: remote[device] });
      return route.fulfill({ json: { ok: true } });
    }
    reads[device]++;
    return route.fulfill({ json: { text: remote[device] } });
  });

  return async () => {
    const waitFor = async predicate => {
      for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await page.waitForTimeout(50);
      }
      assert.fail('Terminal clipboard sync timed out');
    };
    const terminal = page.locator('.tile.focused .terminal-host:not([hidden]) .xterm-helper-textarea');
    const local = value => page.evaluate(text => navigator.clipboard.writeText(text), value);
    const waitForLocal = value => page.waitForFunction(async text => await navigator.clipboard.readText() === text, value);
    await terminal.focus();
    assert.equal(await page.evaluate(() => window.clipboardPromptRequests), 0);
    await page.keyboard.press('a');
    await page.waitForFunction(() => window.clipboardPromptRequests === 1);
    assert.equal(await page.locator('.desktop-viewport').count(), 0);
    await waitFor(() => reads.local >= 2);

    remote.local = 'ターミナル操作中の受信\n二行目';
    await waitForLocal(remote.local);
    await local('ターミナル操作中の送信');
    await waitFor(() => remote.local === 'ターミナル操作中の送信');
    assert.deepEqual(writes, [{ device: 'local', text: remote.local }]);

    await page.locator('[data-tab-id="tab-spark-1"][role=tab]').click();
    await terminal.focus();
    await waitFor(() => reads.spark >= 2);
    assert.equal(writes.length, 1, 'switching devices does not forward the previous clipboard');
    const previousReads = reads.local;
    remote.local = '非アクティブな端末';
    remote.spark = 'Spark から受信';
    await waitForLocal(remote.spark);
    await local('Spark に送信');
    await waitFor(() => remote.spark === 'Spark に送信');
    assert.equal(reads.local, previousReads, 'the previous device stops polling');
    assert.deepEqual(writes.at(-1), { device: 'spark', text: remote.spark });
    console.log('terminal clipboard: permission request, both directions, and device isolation passed');
  };
};
