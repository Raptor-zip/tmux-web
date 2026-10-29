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
  await page.routeWebSocket(/\/events(?:\?|$)/, ws => {
    const remote = ws.url().includes('/devices/spark/');
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
  };
};
