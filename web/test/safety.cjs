// Safety checks: destructive confirmations start on Cancel, device removal asks first,
// and the Alt shortcut switch (tw.altKeys) hands Alt keys back to the terminal.
// SCREENS=devices-modal,desktop-controls SAFETY_CHECK=1 node web/test/visual-feedback.cjs after
const assert = require('node:assert/strict');

const focusedText = page => page.evaluate(() => document.activeElement?.textContent?.trim());

module.exports = async (page, { scene, terminalInputs, requests }) => {
  if (scene.action === 'devices') {
    const modal = page.getByRole('dialog', { name: 'デバイス接続', exact: true });
    await modal.waitFor();
    assert.equal(await modal.getByRole('textbox', { name: '表示名' }).inputValue(), '', 'display name is not prefilled');
    await modal.getByRole('button', { name: '登録を解除…', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: '「DGX Spark」の登録を解除しますか？', exact: true });
    await confirm.waitFor();
    assert.equal(await focusedText(page), 'キャンセル', 'removal confirmation focuses Cancel first');
    await page.keyboard.press('Enter');
    await confirm.waitFor({ state: 'detached' });
    assert.equal(requests.filter(r => r.method === 'DELETE').length, 0, 'Enter on the default focus does not remove the device');
    assert.ok(await modal.isVisible(), 'cancelling keeps the device dialog open');
    await modal.getByRole('button', { name: '登録を解除…', exact: true }).click();
    await confirm.waitFor();
    await confirm.getByRole('button', { name: '登録を解除', exact: true }).click();
    await page.waitForTimeout(150);
    assert.ok(requests.some(r => r.method === 'DELETE' && r.path.includes('/api/devices/spark')), 'confirming removes the device');
    console.log('safety: device removal confirmation passed');
    return;
  }

  const app = page.locator('.app:visible');
  const sidebarHidden = () => app.evaluate(el => el.classList.contains('sidebar-hidden'));
  const terminal = page.locator('.xterm-helper-textarea').first();

  // Alt shortcuts on (default): Alt+B toggles the sidebar and nothing reaches the terminal
  await terminal.focus();
  const before = await sidebarHidden();
  const sent = terminalInputs.length;
  await page.keyboard.press('Alt+b');
  await page.waitForTimeout(100);
  assert.notEqual(await sidebarHidden(), before, 'Alt+B toggles the sidebar by default');
  assert.ok(!terminalInputs.slice(sent).join('').includes('\x1bb'), 'Alt+B is not sent to the terminal while shortcuts are on');
  await terminal.focus();
  await page.keyboard.press('Alt+b');
  await page.waitForTimeout(100);
  assert.equal(await sidebarHidden(), before);

  // Turn them off from 表示と接続 (connection chip → 表示と接続…)
  const openMenu = async (submenu) => {
    await page.locator('.tile.focused').getByRole('button', { name: 'タブの操作', exact: true }).click();
    await page.getByRole('menuitem', { name: submenu, exact: true }).click();
  };
  const settings = page.getByRole('dialog', { name: '表示と接続', exact: true });
  const setAltKeys = async (on) => {
    await page.locator('.conn-status').click();
    await page.getByRole('button', { name: '表示と接続…', exact: true }).click();
    await settings.waitFor();
    const toggle = settings.getByRole('switch', { name: 'Alt ショートカットを使う' });
    assert.equal(await toggle.getAttribute('aria-checked'), String(!on));
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-checked'), String(on));
    await page.keyboard.press('Escape');
    await settings.waitFor({ state: 'detached' });
  };
  await setAltKeys(false);
  assert.equal(await page.evaluate(() => localStorage.getItem('tw.altKeys')), 'false');
  await terminal.focus();
  const sentOff = terminalInputs.length;
  await page.keyboard.press('Alt+b');
  await page.waitForTimeout(150);
  assert.equal(await sidebarHidden(), before, 'Alt+B no longer toggles the sidebar when shortcuts are off');
  assert.ok(terminalInputs.slice(sentOff).join('').includes('\x1bb'), 'Alt+B reaches the terminal as ESC b when shortcuts are off');
  // Workspace-level Alt+Shift shortcuts (new workspace) are released too
  const workspaces = await page.locator('.desktop-tab').count();
  await terminal.focus();
  await page.keyboard.press('Alt+Shift+N');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.desktop-tab').count(), workspaces, 'Alt+Shift+N does not create a workspace when shortcuts are off');
  await setAltKeys(true);
  assert.equal(await page.evaluate(() => localStorage.getItem('tw.altKeys')), 'true');

  // Destructive confirmations start on Cancel, so Enter does not run them
  await openMenu('tmux');
  await page.getByRole('menuitem', { name: /^ペインを終了…/ }).click();
  const dialog = page.locator('dialog[open].prompt-dialog');
  await dialog.waitFor();
  assert.equal(await focusedText(page), 'キャンセル', 'danger confirmation focuses Cancel first');
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'detached' });
  console.log('safety: alt shortcut switch and danger focus passed');
};
