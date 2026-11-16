const assert = require('node:assert/strict');

// Install before navigation. All responses and sockets stay inside the fixture.
module.exports = async function prepareStateConnection(page, { state, terminals }) {
  let allowDevices = false;
  let releaseRest;
  const heldRest = new Promise(resolve => { releaseRest = resolve; });
  const snapshot = (label, device = 'local') => {
    const value = state(device);
    if (device === 'local') for (const pane of value.panes) pane.project = { name: label, root: '/home/demo/projects/' + label };
    return value;
  };
  await page.route(/\/api\/devices$/, route => route.fulfill(allowDevices
    ? { json: { devices: [{ id: 'local', name: 'ThinkPad', local: true }, { id: 'spark', name: 'DGX Spark', local: false, url: 'https://spark.example.ts.net:8443' }] } }
    : { status: 503, json: { error: '一時的に接続できません' } }));
  await page.route(/\/api\/state$/, async route => {
    const remote = route.request().url().includes('/devices/spark/proxy/');
    if (!remote) await heldRest;
    await route.fulfill({ json: snapshot('rest-old', remote ? 'spark' : 'local') });
  });
  let approvalPending = null;
  await page.route(/\/api\/approvals$/, route => route.fulfill({ json: { pending: approvalPending, secure: true } }));
  let dropLocal = false;
  const localSockets = new Set();
  await page.routeWebSocket(/\/events(?:\?|$)/, ws => {
    const remote = ws.url().includes('/devices/spark/');
    if (!remote && dropLocal) { void ws.close().catch(() => {}); return; }
    if (!remote) { localSockets.add(ws); ws.onClose(() => localSockets.delete(ws)); }
    const send = () => ws.send(JSON.stringify({ type: 'state', ...snapshot('stream-current', remote ? 'spark' : 'local') }));
    send();
    ws.onMessage(send);
  });
  return async () => {
    const currentLabel = () => page.locator('[data-tab-id=tab-local-1] .tab-name').textContent();
    assert.equal(await currentLabel(), 'stream-current');
    releaseRest();
    await page.waitForTimeout(150);
    assert.equal(await currentLabel(), 'stream-current', 'late REST response never rolls back the streamed project');
    const before = JSON.parse(await page.evaluate(() => localStorage.getItem('tw.layout')));
    assert.match(JSON.stringify(before), /tab-spark-1/, 'temporary discovery failure preserves saved remote tabs');
    allowDevices = true;
    // Exercise automatic retry, without pressing refresh or reloading the app.
    await page.locator('[data-tab-id=tab-spark-1] .tab-device').waitFor({ timeout: 10000 });
    const deadline = Date.now() + 10000;
    while (terminals() !== 4 && Date.now() < deadline) await page.waitForTimeout(50);
    assert.equal(terminals(), 4, 'discovery recovery connects all saved terminals');
    assert.equal(await page.locator('.tile').count(), 4, 'remote discovery recovery keeps the saved split layout');
    assert.equal(await currentLabel(), 'stream-current');
    const eventConnections = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => entry.name.endsWith('/api/devices')).length);
    assert.ok(eventConnections >= 2, 'device discovery retries after an initial failure');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(150);
    assert.equal(await currentLabel(), 'stream-current', 'wake reconnect retains the latest stream');
    console.log('delayed state, transient device discovery and wake recovery passed');

    // 上バーの接続状態：正常なら点だけ、切断したら『切断』と文字で出し、戻れば点に戻る
    const chip = page.locator('.desktop-bar .conn-status');
    assert.equal((await chip.textContent()).trim(), '', 'the connection chip is only a dot while connected');
    assert.equal(await chip.getAttribute('aria-label'), '接続状態');
    dropLocal = true;
    for (const ws of [...localSockets]) await ws.close().catch(() => {});
    await page.locator('.desktop-bar .conn-status.bad', { hasText: '切断' }).waitFor({ timeout: 5000 });
    assert.equal(await page.locator('.desktop-bar').getByRole('button', { name: '切断', exact: true }).count(), 1, 'the chip is named 切断 when the server is disconnected');
    // ポップオーバー：デバイスごとの状態と、デバイス接続の管理
    await chip.click();
    const popover = page.getByRole('dialog', { name: '接続状態', exact: true });
    await popover.waitFor();
    assert.match(await popover.textContent(), /ThinkPad.*切断/, 'the popover lists the local device as disconnected');
    assert.match(await popover.textContent(), /DGX Spark.*接続済み/, 'the popover lists the remote device as connected');
    await popover.getByRole('button', { name: 'デバイス接続を管理…', exact: true }).click();
    const devices = page.getByRole('dialog', { name: 'デバイス接続', exact: true });
    await devices.waitFor();
    await page.keyboard.press('Escape');
    await devices.waitFor({ state: 'detached' });
    // Esc はチップにフォーカスがあってもポップオーバーを閉じる
    await chip.click();
    await popover.waitFor();
    await chip.focus();
    await page.keyboard.press('Escape');
    await popover.waitFor({ state: 'detached' });
    dropLocal = false;
    await page.locator('.desktop-bar .conn-status.ok, .desktop-bar .conn-status.partial').waitFor({ timeout: 10000 });
    assert.equal((await chip.textContent()).trim(), '', 'the chip returns to a dot after reconnecting');
    console.log('connection chip shows 切断 while disconnected and recovers');

    // ⚠ 承認待ち：チップと assertive のトーストが出て、チップから内容の確認を開ける。全幅のバナーもまだ残す
    approvalPending = { id: 'a1', cmd: 'sudo apt install ripgrep', cwd: '/home/demo', detail: '', attempt: 1, expiresAt: Date.now() + 120000 };
    const approvalChip = page.locator('.desktop-bar').getByRole('button', { name: /^承認待ち 1$/ });
    await approvalChip.waitFor({ timeout: 8000 });
    assert.match(await page.locator('.toasts [role=alert]').textContent(), /sudo の承認待ち：sudo apt install ripgrep/, 'first detection is announced assertively');
    assert.equal(await page.locator('.approval-notice').count(), 1, 'the full-width banner stays for now');
    await approvalChip.click();
    const approvalDialog = page.getByRole('dialog', { name: '管理者権限での実行を確認', exact: true });
    await approvalDialog.waitFor();
    await page.keyboard.press('Escape');
    await approvalDialog.waitFor({ state: 'detached' });
    approvalPending = null;
    await approvalChip.waitFor({ state: 'detached', timeout: 8000 });
    console.log('approval chip and assertive toast passed');

    // ≡ は一覧の開閉。左レールはもう無い
    assert.equal(await page.locator('.sidebar-launcher').count(), 0, 'the left launcher rail is gone');
    const menuButton = page.locator('.desktop-bar').getByRole('button', { name: '一覧', exact: true });
    const pressed = await menuButton.getAttribute('aria-pressed');
    await menuButton.click();
    assert.notEqual(await menuButton.getAttribute('aria-pressed'), pressed, '≡ toggles the sidebar');
    await menuButton.click();
    assert.equal(await menuButton.getAttribute('aria-pressed'), pressed);

    // ◆ 入力待ち：押すと入力待ちだけに絞ったパレットが開く
    const attention = page.locator('.desktop-bar').getByRole('button', { name: /^入力待ち \d+$/ });
    {
      await attention.waitFor({ timeout: 5000 });
      assert.match(await attention.getAttribute('title'), /^入力待ち \d+ \(Alt\+J で次へ\)$/, 'the chip tooltip starts with its visible label');
      await attention.click();
      const palette = page.getByRole('dialog', { name: '探す・操作', exact: true });
      await palette.waitFor();
      assert.equal(await palette.getByRole('button', { name: '入力待ちだけ', exact: true }).getAttribute('aria-pressed'), 'true');
      const options = await palette.getByRole('option').count();
      const waitingRows = await palette.locator('.sw-row.st-waiting').count();
      assert.ok(options > 0 && options === waitingRows, 'only waiting terminals are listed');
      await page.keyboard.press('Escape');
      await palette.waitFor({ state: 'detached' });
    }
    // ⌕ 探す・操作
    await page.locator('.desktop-bar').getByRole('button', { name: '探す・操作', exact: true }).click();
    const palette = page.getByRole('dialog', { name: '探す・操作', exact: true });
    await palette.waitFor();
    assert.equal(await palette.getByRole('button', { name: '入力待ちだけ', exact: true }).getAttribute('aria-pressed'), 'false');
    await page.keyboard.press('Escape');
    await palette.waitFor({ state: 'detached' });
    console.log('top bar sidebar, attention and palette buttons passed');
  };
};
