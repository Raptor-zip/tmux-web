// Run with the synthetic API/WebSocket fixture in visual-feedback.cjs:
// SCREENS=desktop-controls DESKTOP_TRANSFER_CHECK=1 node web/test/visual-feedback.cjs after
const assert = require('node:assert/strict');
module.exports = async (page, errors) => {
  await page.evaluate(() => {
    localStorage.setItem('tw.desktops', JSON.stringify({ activeId: 'main', items: [
      { id: 'main', name: 'デスクトップ1' }, { id: 'second', name: 'デスクトップ2' },
    ] }));
    const tab = { id: 'existing', sessionId: '$1', windowId: '@2', sessionName: 'development', windowIndex: 1 };
    localStorage.setItem('tw.layout.second', JSON.stringify({type:'leaf', id:'second-panel', tabs:[tab], activeId:tab.id}));
    localStorage.setItem('tw.serverPid.second', '"local:501|spark:502"');
  });
  await page.reload();
  const visibleTab = () => page.locator('.desktop-panel:visible .tab').first();
  const desktop = id => page.locator(`[data-desktop-id="${id}"]`);
  const begin = async id => {
    const source = await page.locator('.desktop-panel:visible .tab.active').boundingBox();
    const target = await desktop(id).boundingBox();
    await page.mouse.move(source.x + 30, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + 40, source.y + source.height / 2);
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {steps:8});
    await page.waitForFunction(id => document.querySelector(`[data-desktop-id="${id}"]`).classList.contains('drop-target'), id);
  };
  const selected = async id => {
    await page.waitForFunction(id => document.querySelector(`[data-desktop-id="${id}"]`).getAttribute('aria-selected') === 'true', id);
  };
  const saved = () => page.evaluate(() => ({
    source: JSON.parse(localStorage.getItem('tw.layout')),
    destination: JSON.parse(localStorage.getItem('tw.layout.second')),
  }));
  await visibleTab().waitFor();
  // Escape cancels without selecting the destination or changing either layout.
  const before = await saved();
  await begin('second');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await selected('main');
  assert.equal(await page.locator('.drop-target, .drag-catcher').count(), 0);
  assert.deepEqual(await saved(), before);
  // First visit: preserve the destination's saved tab and append the dragged tab.
  await begin('second');
  await page.mouse.up();
  await selected('second');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('tw.layout')) === null);
  let result = await saved();
  assert.equal(result.source, null);
  assert.deepEqual(result.destination.tabs.map(t => t.windowId), ['@2', '@1']);
  assert.equal(result.destination.activeId, 'tab-local-1');
  // Return to an already visited empty desktop, then verify reload persistence.
  await begin('main');
  await page.mouse.up();
  await selected('main');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('tw.layout'))?.tabs[0]?.windowId === '@1');
  result = await saved();
  assert.deepEqual(result.destination.tabs.map(t => t.windowId), ['@2']);
  await page.reload();
  await visibleTab().waitFor();
  assert.deepEqual(await saved(), result);
  // The existing tab-reordering path still works after a transfer.
  await desktop('second').click();
  await begin('main');
  await page.mouse.up();
  await selected('main');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('tw.layout'))?.tabs.length === 2);
  const tabs = page.locator('.desktop-panel:visible .tab');
  const a = await tabs.nth(1).boundingBox();
  const b = await tabs.nth(0).boundingBox();
  await page.mouse.move(a.x + 30, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + a.height / 2);
  await page.mouse.move(b.x + 5, b.y + b.height / 2, {steps:8}); await page.mouse.up();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('tw.layout'))?.tabs[0]?.windowId === '@2');
  assert.deepEqual(errors, [], 'no runtime errors during desktop transfers');
  console.log('Desktop transfers, cancellation, reload persistence and tab reordering passed');
};
