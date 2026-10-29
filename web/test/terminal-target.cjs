const assert = require('node:assert/strict');

module.exports = async function checkTerminalTarget(page, { terminalTransports, terminalSelections }) {
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const waitFor = async predicate => {
    for (let i = 0; i < 150; i++) {
      if (predicate()) return;
      await page.waitForTimeout(20);
    }
    assert.fail('terminal target fixture did not receive the expected transport message');
  };
  await waitFor(() => terminalSelections.length > 0);
  check(terminalTransports[0].window === '@1', 'the initial request includes its window ID');
  check(terminalSelections[0].windowId === '@1', 'the startup selection includes its window ID');
  await page.locator('[data-tab-id="tab-local-2"][role=tab]').click();
  await waitFor(() => terminalSelections.at(-1)?.index === 1);
  check(terminalSelections.at(-1).windowId === '@2', 'same-session switching includes its stable window ID');
  assert.equal(terminalTransports.length, 1, 'same-session switching does not reconnect');
  terminalTransports[0].socket.close();
  await waitFor(() => terminalTransports.length === 2);
  check(terminalTransports[1].window === '@2', 'reconnection requests the currently selected window');
  await waitFor(() => terminalSelections.at(-1)?.index === 1);
  check(terminalSelections.at(-1).windowId === '@2', 'reconnection selects the current window ID');
  await page.locator('[data-tab-id="tab-spark-1"][role=tab]').click();
  await waitFor(() => terminalTransports.at(-1)?.remote && terminalSelections.at(-1)?.remote);
  check(terminalTransports.at(-1).window === '@1', 'remote connection URLs use the device-local window ID');
  check(terminalSelections.at(-1).windowId === '@1', 'remote selection messages use the device-local window ID');
  assert.deepEqual(failures, []);
  console.log('terminal window identity: startup, switching, reconnect and remote device passed');
};
