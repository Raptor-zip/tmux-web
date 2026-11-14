const assert = require('node:assert/strict');

module.exports = async (page, { terminalTransports }) => {
  const waitFor = async predicate => {
    for (let i = 0; i < 150; i++) {
      if (predicate()) return;
      await page.waitForTimeout(20);
    }
    assert.fail('direct mode fixture did not receive expected transport message');
  };
  const tab = number => page.locator(`[data-tab-id="tab-local-${number}"][role=tab]`);
  await waitFor(() => terminalTransports[0]?.selections.length > 0);
  const first = terminalTransports[0];
  await tab(2).click();
  await waitFor(() => terminalTransports[1]?.selections.at(-1)?.windowId === '@2');
  const second = terminalTransports[1];
  const count = terminalTransports.length;
  const previous = first.selections.length;
  await tab(1).click();
  await waitFor(() => first.selections.length > previous);
  assert.equal(first.selections.at(-1).windowId, '@1', 'returning to direct tab restores its shared tmux selection');
  assert.equal(terminalTransports.length, count, 'direct mode return reuses the existing transport');
  const selections = second.selections.length;
  // While hidden, an actual network failure can recover without selecting its window.
  second.socket.close();
  await waitFor(() => terminalTransports.length === count + 1);
  const replacement = terminalTransports.at(-1);
  assert.equal(replacement.window, null, 'hidden direct reconnect does not select a window in its URL');
  await page.waitForTimeout(100);
  assert.equal(replacement.selections.length, 0, 'hidden direct reconnect does not steal the foreground window');
  assert.equal(second.selections.length, selections);
  await tab(2).click();
  await waitFor(() => replacement.selections.at(-1)?.windowId === '@2');
  await page.locator('.panel-connection:visible').waitFor({ state: 'detached' });
  await page.locator('.terminal-host:visible .xterm-helper-textarea').focus();
  await page.keyboard.type('direct-input');
  await waitFor(() => replacement.inputs.join('').includes('direct-input'));
  assert.equal(first.inputs.length, 0, 'only the selected direct tab receives input');
  console.log('direct mode: cached transport, foreground selection, hidden recovery and input routing passed');
};
