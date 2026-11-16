const assert = require('node:assert/strict');

// REMOTE_COMPACT_CHECK：ダイアログで大きく表示した画面。見出しは 1 段（接続先・状態・⌨・Esc・⋯・×）で、
// 画面の操作は ⋯ の画面メニュー、画質はモーダル、文字入力は画面に重ねる小窓。どれも画面の大きさを変えない。
module.exports = async function checkRemoteLayout(page, scene) {
  const stage = () => page.locator('.desktop-stage').boundingBox();
  const original = await stage();
  assert.equal(original.width, scene.width, 'remote screen uses the full browser width');
  assert.ok(original.height >= scene.height - 52, 'only one compact row reduces the remote screen height');
  const dialog = page.getByRole('dialog', {name:'リモートデスクトップ',exact:true});
  const closePopover = async () => {
    const quality = page.getByRole('dialog', {name:'画質',exact:true});
    if (await quality.count()) await quality.getByRole('button', {name:'キャンセル',exact:true}).click();
    const close = page.getByRole('button', {name:'文字入力を閉じる'});
    if (await close.count()) await close.click();
  };
  const more = dialog.getByRole('button', {name:'画面の操作',exact:true});
  const menu = async name => { await more.click(); await page.getByRole('menuitem', {name, exact:true}).click(); };
  await closePopover();
  // 見出しは 1 段。2 段目のツールバー（操作・設定）とグリッドのアイコンは無い
  assert.equal(await dialog.locator('.desktop-compact-head').count(), 1);
  assert.equal(await dialog.getByRole('button', {name:'操作・設定',exact:true}).count(), 0);
  for (const name of ['文字入力', 'Esc を送る', '画面の操作', 'リモートデスクトップを閉じる']) {
    const box = await dialog.getByRole('button', {name, exact:true}).boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= scene.width + 0.5, `${name} fits in the header`);
  }
  await menu('見るだけ');
  await dialog.locator('.screen-badge', {hasText:'見るだけ'}).waitFor();
  await menu('原寸で表示');
  await menu('画質…');
  const quality = page.getByRole('dialog', {name:'画質',exact:true});
  await quality.waitFor();
  assert.deepEqual(await stage(), original, 'quality dialog overlays the desktop without shrinking it');
  assert.ok(await quality.evaluate(el => el.contains(document.activeElement)), 'focus moves into the quality dialog');
  assert.equal(await quality.getByRole('radio').count(), 4, 'four presets');
  const panel = await quality.boundingBox();
  assert.ok(panel.x >= 0 && panel.y + panel.height <= scene.height + 0.5, 'quality dialog stays within the viewport');
  await quality.getByRole('button', {name:'キャンセル',exact:true}).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '画面の操作');
  assert.equal(await dialog.count(), 1, 'closing the quality dialog keeps the screen open');
  await dialog.getByRole('button', {name:'文字入力',exact:true}).click();
  assert.deepEqual(await stage(), original, 'input panel does not resize the desktop');
  for (const name of ['貼り付け（Ctrl+V）', 'キーとして送る', '送って Enter', '接続先からコピー']) assert.equal(await dialog.getByRole('button', {name, exact:true}).count(), 1, name);
  await page.locator('.desktop-clipboard textarea').fill('日本語の下書き');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.desktop-clipboard textarea').count(), 0, 'Escape dismisses the panel first');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '文字入力');
  assert.equal(await dialog.count(), 1);
  await dialog.getByRole('button', {name:'文字入力',exact:true}).click();
  assert.equal(await page.locator('.desktop-clipboard textarea').inputValue(), '日本語の下書き', 'draft survives reopening');
  await closePopover();
  // メニューを Escape で閉じても、ダイアログは閉じない
  await more.click();
  await page.getByRole('menuitem', {name:'操作する',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('menuitem', {name:'操作する',exact:true}).count(), 0);
  assert.equal(await dialog.count(), 1, 'Escape closes the menu, not the screen');
  await menu('操作する');
  assert.equal(await dialog.locator('.screen-badge').count(), 0);
  await menu('画面に合わせる');
  console.log('remote desktop compact layout and controls passed: '+scene.name);
};
