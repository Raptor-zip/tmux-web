const assert = require('node:assert/strict');

module.exports = async function checkTerminalTarget(page, { terminalTransports, terminalSelections }) {
  const waitFor = async predicate => {
    for (let i = 0; i < 150; i++) {
      if (predicate()) return;
      await page.waitForTimeout(20);
    }
    assert.fail('terminal target fixture did not receive the expected transport message');
  };
  const select = id => page.locator(`[data-tab-id="${id}"][role=tab]`).click();
  const text = () => page.locator('.terminal-host:visible .xterm-rows').textContent();
  await waitFor(() => terminalSelections.length > 0);
  assert.equal(terminalTransports[0].window, '@1', 'initial request includes its window ID');
  assert.equal(terminalSelections[0].windowId, '@1', 'startup selection includes its window ID');
  const first = terminalTransports[0];
  first.socket.send(Buffer.from('\x1b[2J\x1b[Hfirst-tab-cached'));
  await page.waitForFunction(() => document.querySelector('.terminal-host:not([hidden]) .xterm-rows')?.textContent.includes('first-tab-cached'));
  await select('tab-local-2');
  await waitFor(() => terminalTransports.length === 2 && terminalSelections.at(-1)?.index === 1);
  const second = terminalTransports[1];
  assert.equal(second.window, '@2', 'first visit creates a terminal for its stable window ID');
  assert.equal(first.closed, undefined, 'background tab keeps its connection');
  second.socket.send(Buffer.from('\x1b[2J\x1b[Hsecond-tab-cached'));
  await page.waitForFunction(() => document.querySelector('.terminal-host:not([hidden]) .xterm-rows')?.textContent.includes('second-tab-cached'));
  await select('tab-local-1');
  assert.match(await text(), /first-tab-cached/, 'returning shows the existing terminal content immediately');
  await select('tab-local-2');
  assert.match(await text(), /second-tab-cached/, 'each tab retains its own terminal content');
  assert.equal(terminalTransports.length, 2, 'revisiting tabs does not reconnect');
  second.socket.close();
  await waitFor(() => terminalTransports.length === 3);
  assert.equal(terminalTransports[2].window, '@2', 'actual connection loss reconnects the affected tab');
  await waitFor(() => terminalSelections.at(-1)?.index === 1);
  await select('tab-spark-1');
  await waitFor(() => terminalTransports.at(-1)?.remote && terminalSelections.at(-1)?.remote);
  const count = terminalTransports.length;
  assert.equal(terminalTransports.at(-1).window, '@1', 'remote connection URLs use the device-local window ID');
  assert.equal(terminalSelections.at(-1).windowId, '@1', 'remote selection messages use the device-local window ID');
  await select('tab-local-1');
  assert.match(await text(), /first-tab-cached/, 'switching devices restores the existing screen');
  await select('tab-spark-1');
  assert.equal(terminalTransports.length, count, 'switching between devices does not reconnect visited tabs');
  const remote = terminalTransports.at(-1);
  await page.locator('[data-tab-id="tab-spark-1"][role=tab] .tab-close').click();
  await waitFor(() => remote.closed);
  assert.equal(terminalTransports.length, count, 'closing a tab does not recreate another transport');
  assert.equal(first.closed, undefined, 'closing one tab preserves the other tabs');
  console.log('terminal tabs: cached screens, persistent transports, stable targets, recovery and cleanup passed');
};
