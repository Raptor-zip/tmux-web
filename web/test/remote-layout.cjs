const assert = require('node:assert/strict');

module.exports = async function checkRemoteLayout(page, scene) {
  const stage = () => page.locator('.desktop-stage').boundingBox();
  const original = await stage();
  assert.equal(original.width, scene.width, 'remote screen uses the full browser width');
  assert.ok(original.height >= scene.height - 52, 'only one compact row reduces the remote screen height');
  const closePopover = async () => {
    const close = page.getByRole('button', {name:/^(操作・設定|文字入力・コピー|画質・遅延設定)を閉じる$/});
    if (await close.count()) await close.click();
  };
  await closePopover();
  await page.getByRole('button', {name:'操作・設定',exact:true}).click();
  await page.getByRole('button', {name:'見るだけ',exact:true}).click();
  assert.equal(await page.getByRole('button', {name:'見るだけ',exact:true}).getAttribute('aria-pressed'), 'true');
  await page.getByLabel('デスクトップの表示サイズ', {exact:true}).selectOption('actual');
  await page.getByRole('button', {name:'画質・遅延設定',exact:true}).click();
  assert.deepEqual(await stage(), original, 'quality panel overlays the desktop without shrinking it');
  assert.ok(await page.locator('#desktop-settings-panel').evaluate(el => el.contains(document.activeElement)), 'focus follows the opened settings panel');
  const panel = await page.locator('#desktop-settings-panel').boundingBox();
  assert.ok(panel.x >= 0 && panel.y + panel.height <= scene.height, 'settings stay within the viewport');
  await closePopover();
  assert.equal(await page.locator('.desktop-controls-toggle').evaluate(el => el === document.activeElement), true, 'closing settings restores the header focus');
  await page.getByRole('button', {name:'文字入力・コピー',exact:true}).click();
  assert.deepEqual(await stage(), original, 'input panel does not resize the desktop');
  await page.locator('#desktop-text').fill('日本語の下書き');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#desktop-text').count(), 0, 'Escape dismisses the panel first');
  assert.equal(await page.getByRole('button', {name:'文字入力・コピー',exact:true}).evaluate(el => el === document.activeElement), true, 'Escape restores the input trigger focus');
  assert.equal(await page.getByRole('dialog', {name:'リモートデスクトップ',exact:true}).count(), 1);
  await page.getByRole('button', {name:'文字入力・コピー',exact:true}).click();
  assert.equal(await page.locator('#desktop-text').inputValue(), '日本語の下書き', 'draft survives reopening');
  await closePopover();
  await page.getByRole('button', {name:'操作・設定',exact:true}).click();
  await page.getByRole('button', {name:'操作する',exact:true}).click();
  await page.getByLabel('デスクトップの表示サイズ', {exact:true}).selectOption('fit');
  await closePopover();
  console.log('remote desktop compact layout and controls passed: '+scene.name);
};
