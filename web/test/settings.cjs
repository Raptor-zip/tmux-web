// 表示と接続: opened from the palette and the connection chip, settings are shared by every
// workspace, the input bar replaces the key bar switch, the connection mode asks first, and the
// install button is gone from the top bar.
// SCREENS=desktop-controls,mobile-panels SETTINGS_CHECK=1 node web/test/visual-feedback.cjs after
const assert = require('node:assert/strict');

module.exports = async (page, { scene, terminalTransports, out }) => {
  const settings = page.getByRole('dialog', { name: '表示と接続', exact: true });
  const stored = key => page.evaluate(k => localStorage.getItem(k), key);
  assert.equal(await page.locator('.desktop-bar').getByRole('button', { name: /アプリとして/ }).count(), 0, 'no install button in the top bar');

  // From the palette's 操作 scope
  const palette = page.getByRole('dialog', { name: '探す・操作', exact: true });
  await page.locator('.bar-palette').click();
  await palette.waitFor();
  await palette.getByRole('combobox').fill('>表示と接続');
  await palette.locator('.sw-row.on .sw-command', { hasText: '表示と接続…' }).waitFor();
  await page.keyboard.press('Enter');
  await settings.waitFor();
  if (out && !process.env.NO_SCREENSHOTS) await page.screenshot({ path: `${out}/${scene.name}-settings.png` });

  // Font size: － / ＋ / 既定に戻す, applied to the terminal
  const fontBefore = await page.locator('.xterm-rows').first().evaluate(el => getComputedStyle(el).fontSize);
  await settings.getByRole('button', { name: '文字を大きく', exact: true }).click();
  assert.equal(await stored('tw.fontSize'), '14');
  await page.waitForFunction(before => getComputedStyle(document.querySelector('.xterm-rows')).fontSize !== before, fontBefore);
  await settings.getByRole('button', { name: '既定に戻す' }).first().click();
  assert.equal(await stored('tw.fontSize'), '13');

  // Line height slider
  const slider = settings.getByRole('slider', { name: '行間' });
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await stored('tw.lineHeight'), '1.16');
  await page.keyboard.press('Home');
  assert.equal(await stored('tw.lineHeight'), '1');

  // Input bar: 隠す removes it, 常に表示 adds the key row, 自動 goes back
  const inputBar = settings.getByRole('radiogroup', { name: '入力行' });
  const visibleInput = () => page.locator('.mobile-input:visible').count();
  const autoVisible = await visibleInput();
  assert.equal(autoVisible, scene.touch ? 1 : 0, '自動 shows the input bar only on touch or narrow screens');
  await inputBar.getByRole('radio', { name: '隠す', exact: true }).click();
  assert.equal(await stored('tw.inputBar'), '"hidden"');
  assert.equal(await page.locator('.mobile-input').count(), 0, '隠す removes the input bar');
  await inputBar.getByRole('radio', { name: '常に表示', exact: true }).click();
  assert.equal(await visibleInput(), 1, '常に表示 shows the input bar on every screen');
  assert.equal(await page.locator('.keybar').count(), 1, '常に表示 keeps the old key bar row');
  await inputBar.getByRole('radio', { name: '自動', exact: true }).click();
  assert.equal(await visibleInput(), autoVisible);
  assert.equal(await page.locator('.keybar').count(), 0);

  // tmux status line and the phone/landscape switches are stored
  for (const [name, key] of [['tmux のステータス行', 'tw.statusBar'], ['スマホでタブ列を表示', 'tw.phoneTabs'], ['横持ちで見出しを隠す', 'tw.landscapeHideHeader']]) {
    const sw = settings.getByRole('switch', { name, exact: true });
    await sw.click();
    assert.equal(await sw.getAttribute('aria-checked'), 'true', `${name} turns on`);
    assert.equal(await stored(key), 'true');
    await sw.click();
    assert.equal(await stored(key), 'false');
  }

  // Connection mode asks before reconnecting every terminal
  const modes = settings.getByRole('radiogroup', { name: '接続方式' });
  await modes.getByRole('radio', { name: '直接', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: /接続方式を『.+』に切り替えますか/ });
  await confirm.waitFor();
  await confirm.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await confirm.waitFor({ state: 'detached' });
  assert.notEqual(await stored('tw.mode'), '"direct"', 'cancelling keeps the mode');
  assert.equal(await modes.getByRole('radio', { name: 'ミラー', exact: true }).getAttribute('aria-checked'), 'true');
  const opened = terminalTransports.length;
  await modes.getByRole('radio', { name: '直接', exact: true }).click();
  await confirm.getByRole('button', { name: '切り替える', exact: true }).click();
  assert.equal(await stored('tw.mode'), '"direct"');
  await page.waitForTimeout(500);
  assert.ok(terminalTransports.slice(opened).some(t => t.mode === 'direct'), 'terminals reconnect in direct mode');
  await modes.getByRole('radio', { name: 'ミラー', exact: true }).click();
  await confirm.getByRole('button', { name: '切り替える', exact: true }).click();
  assert.equal(await stored('tw.mode'), '"mirror"');

  // Version, install and the shortcut list
  assert.match(await settings.locator('.settings-versions').innerText(), /tmux 3\.4/);
  assert.equal(await settings.getByRole('button', { name: 'アプリとして追加' }).count(), 1, 'install lives in 表示と接続');
  await settings.getByRole('button', { name: /ショートカット一覧を開く/ }).click();
  const shortcuts = page.getByRole('dialog', { name: 'ショートカット一覧', exact: true });
  await shortcuts.waitFor();
  assert.ok(!await settings.isVisible(), 'the settings dialog gives way to the shortcut list');
  await page.keyboard.press('Escape');
  await shortcuts.waitFor({ state: 'detached' });

  // From the connection chip, and the browser install help when no prompt is available
  await page.locator('.conn-status').click();
  await page.getByRole('button', { name: '表示と接続…', exact: true }).click();
  await settings.waitFor();
  await settings.getByRole('button', { name: 'アプリとして追加' }).click();
  const help = page.getByRole('dialog', { name: 'アプリとして使う', exact: true });
  await help.waitFor();
  await page.keyboard.press('Escape');
  await help.waitFor({ state: 'detached' });
  await page.keyboard.press('Escape');
  await settings.waitFor({ state: 'detached' });
  console.log(`settings: ${scene.name} passed`);
};
