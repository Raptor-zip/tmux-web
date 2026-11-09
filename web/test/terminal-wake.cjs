const assert = require('node:assert/strict');

module.exports = async function checkTerminalWake(page, { terminalTransports, terminalInputs }) {
  const rows = page.locator('.xterm-rows').first();
  await rows.waitFor();
  assert.equal(await page.locator('.xterm-screen canvas').count(), 0, 'terminal rendering does not depend on a canvas context');
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent.includes('ThinkPad'));

  for (let cycle = 0; cycle < 3; cycle++) {
    const previous = terminalTransports.length;
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(100);
    assert.ok(terminalTransports.at(-1).closed, 'hidden terminals release their connection');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pageshow'));
    });
    for (let attempt = 0; attempt < 100 && terminalTransports.length === previous; attempt++) await page.waitForTimeout(20);
    await page.locator('.panel-connection').waitFor({ state: 'detached' });
    assert.ok(terminalTransports.length > previous, 'returning to the tab reconnects the terminal');
    const marker = `wake-cycle-${cycle}`;
    terminalTransports.at(-1).socket.send(Buffer.from(`\x1b[2J\x1b[H${marker}\r\n日本語の描画確認`));
    await page.waitForFunction(marker => document.querySelector('.xterm-rows')?.textContent.includes(marker), marker);
    assert.ok((await rows.textContent()).includes('日本語の描画確認'));
  }
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.xterm-screen canvas').count(), 0);
  await page.locator('.xterm-helper-textarea').first().focus();
  await page.keyboard.type('wake-input');
  await page.waitForTimeout(50);
  assert.ok(terminalInputs.join('').includes('wake-input'), 'keyboard input still reaches the terminal after wake');
  console.log('terminal wake: repeated hide/show, focus, pageshow, reconnect, output, resize and input passed');
};
