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
    assert.ok(terminalTransports.every(transport => !transport.closed), 'hidden terminals keep their connections');
    const marker = `wake-cycle-${cycle}`;
    terminalTransports[0].socket.send(Buffer.from(`\x1b[2J\x1b[H${marker}\r\n日本語の描画確認`));
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pageshow'));
    });
    await page.waitForFunction(marker => document.querySelector('.xterm-rows')?.textContent.includes(marker), marker);
    assert.equal(terminalTransports.length, previous, 'returning to the browser tab does not reconnect');
    assert.equal(await page.locator('.panel-connection:visible').count(), 0, 'returning does not show a reconnect overlay');
    assert.ok((await rows.textContent()).includes('日本語の描画確認'));
  }
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.xterm-screen canvas').count(), 0);
  await page.locator('.xterm-helper-textarea').first().focus();
  await page.keyboard.type('wake-input');
  await page.waitForTimeout(50);
  assert.ok(terminalInputs.join('').includes('wake-input'), 'keyboard input still reaches the terminal after wake');
  console.log('terminal wake: persistent hide/show, background output, focus, pageshow, resize and input passed');
};
