const assert = require('node:assert/strict');

// Live state and keyboard events use synthetic data in an isolated browser.
module.exports = async function prepareSwitcher(page, { state, scene }) {
  let local = state('local'), publish;
  await page.routeWebSocket(url => url.pathname === '/ws/events', ws => {
    publish = () => ws.send(JSON.stringify({ type: 'state', ...local }));
    publish(); ws.onMessage(publish);
  });
  return async () => {
    const failures = [];
    const check = (condition, message) => { if (!condition) failures.push(message); };
    const dialog = page.getByRole('dialog', { name: '探す・操作', exact: true });
    const input = dialog.locator('.sw-input');
    // スマホ縦では ⌕ が見出しに無いので、タブ一覧シートの『すべての端末を探す』から開く
    const direct = page.locator('.desktop-bar .bar-palette:visible');
    const opener = async () => (await direct.count()) ? direct : page.locator('.desktop-bar .phone-tab');
    const trigger = {
      click: async () => {
        if (await direct.count()) return direct.click();
        await page.locator('.desktop-bar .phone-tab').click();
        await page.getByRole('dialog', { name: 'タブ一覧', exact: true }).getByRole('button', { name: 'すべての端末を探す', exact: true }).click();
      },
      // 開いた操作へフォーカスが戻る。シート経由ではシートを開いた『現在のタブ ▾』へ戻る
      evaluate: async fn => (await opener()).evaluate(fn),
    };
    const dismiss = () => dialog.getByRole('button', { name: '探す・操作を閉じる', exact: true });
    const open = async () => { await trigger.click(); await dialog.waitFor(); };
    await dialog.waitFor();
    check(await dialog.evaluate(node => node.contains(document.activeElement)), 'opening keeps focus inside the palette');
    if (scene.touch) check(await input.evaluate(node => node !== document.activeElement), 'touch opening does not force the software keyboard');
    await input.focus();
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true });
    check(await dialog.isVisible(), 'IME confirmation must not select a window');
    if (!await dialog.isVisible()) await open();
    // WebKit can report the confirmation Enter with keyCode 229 after compositionend.
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: false, bubbles: true, cancelable: true });
    check(await dialog.isVisible(), 'IME fallback Enter must not select a window');
    if (!await dialog.isVisible()) await open();
    await input.focus();
    const list = dialog.locator('.sw-list');
    await list.evaluate(node => { node.scrollTop = 120; });
    const scroll = await list.evaluate(node => node.scrollTop);
    local = { ...local, panes: local.panes.map((pane, index) => index ? pane : { ...pane, title: 'fixture-updated-title' }) };
    publish();
    await dialog.getByText('fixture-updated-title', { exact: true }).waitFor({ state: 'attached' });
    check(Math.abs(await list.evaluate(node => node.scrollTop) - scroll) < 2, 'live updates preserve manual list scrolling');
    local = state('local'); publish();
    await dialog.getByText('fixture-updated-title', { exact: true }).waitFor({ state: 'detached' });
    await input.focus(); await page.keyboard.press('ArrowDown');
    const selected = await dialog.locator('.sw-row.on .sub-rest').innerText();
    local = { ...local, panes: local.panes.map(pane => ({ ...pane, busy: false })) };
    publish();
    await page.waitForFunction(() => document.querySelectorAll('.switcher .sw-row.st-working').length === 4);
    check(await dialog.locator('.sw-row.on .sub-rest').innerText() === selected, 'status reordering keeps the chosen window selected');
    await dismiss().focus(); await page.keyboard.press('Tab');
    // WebKit can visit browser chrome (BODY) before cycling into the modal.
    if (await page.evaluate(() => document.activeElement === document.body)) await page.keyboard.press('Tab');
    check(await dialog.evaluate(node => node.contains(document.activeElement)), 'Tab from the close button cannot reach the workspace');
    await trigger.evaluate(node => node.focus());
    check(await trigger.evaluate(node => node !== document.activeElement), 'the native modal blocks background focus');
    await dismiss().focus(); await page.keyboard.press('Escape');
    check(!await dialog.isVisible(), 'Escape closes the palette from the close button');
    if (await dialog.isVisible()) await dismiss().click();
    check(await trigger.evaluate(node => document.activeElement === node), 'closing restores the opening control');
    await open(); await input.focus();
    await page.keyboard.press('ArrowUp');
    assert.equal(await dialog.locator('.sw-row').count(), 24);
    local = { ...local, windows: local.windows.slice(0, 1), panes: local.panes.slice(0, 1) };
    publish();
    await page.waitForFunction(() => document.querySelectorAll('.switcher .sw-row').length === 13);
    check(await dialog.locator('.sw-row.on').count() === 1, 'live removal leaves a selected result');
    const active = await input.getAttribute('aria-activedescendant');
    check(!!active && await page.evaluate(id => document.getElementById(id)?.getAttribute('aria-selected') === 'true', active), 'the combobox identifies the selected option');
    await page.keyboard.press('Enter');
    check(!await dialog.isVisible(), 'Enter still opens a result after live removal');
    if (await dialog.isVisible()) await dismiss().click();
    local = state('local'); publish();
    await open();
    await page.waitForFunction(() => document.querySelectorAll('.switcher .sw-row').length === 24);
    await input.fill('no-matching-fixture-window');
    await dialog.locator('.sw-empty').waitFor();
    await page.keyboard.press('Enter');
    check(await dialog.isVisible(), 'Enter on an empty search keeps the palette open');
    await input.fill('DGX Spark');
    await page.waitForFunction(() => document.querySelectorAll('.switcher .sw-row').length === 12);
    check((await dialog.locator('.sw-row .sub-rest').allTextContents()).every(text => text.includes('DGX Spark')), 'device search only returns the named device');
    await input.fill('');
    await page.waitForFunction(() => document.querySelectorAll('.switcher .sw-row').length === 24);
    // Scopes: tabs of this workspace, then commands from the registry.
    const scopeButton = name => dialog.getByRole('button', { name, exact: true });
    await scopeButton('タブ').click();
    check(await scopeButton('タブ').getAttribute('aria-pressed') === 'true', 'the tab scope can be selected');
    await input.fill('');
    await dialog.locator('.sw-tab').first().waitFor();
    check(await dialog.locator('.sw-row:not(.sw-tab)').count() === 0, 'the tab scope lists only open tabs');
    check((await dialog.locator('.sw-section').first().innerText()).startsWith('パネル「'), 'tab groups are named after the shown tab');
    await scopeButton('操作').click();
    await input.fill('キーバー');
    await dialog.locator('.sw-cmd').first().waitFor();
    check((await dialog.locator('.sw-row.on .sw-command').innerText()) === '入力行の表示を切り替える', 'command search finds the input bar by its old name');
    const alwaysBefore = await page.locator('.input-bar.input-always').count();
    await input.focus(); await page.keyboard.press('Enter');
    check(!await dialog.isVisible(), 'running a command closes the palette');
    await page.waitForFunction(n => document.querySelectorAll('.input-bar.input-always').length !== n, alwaysBefore);
    // Alt+Shift+P opens the command scope directly; a leading > switches to it.
    await page.keyboard.press('Alt+Shift+P');
    await dialog.waitFor();
    check(await scopeButton('操作').getAttribute('aria-pressed') === 'true', 'Alt+Shift+P opens the command scope');
    await scopeButton('端末').click();
    await input.fill('>キーバー');
    check(await scopeButton('操作').getAttribute('aria-pressed') === 'true' && await input.inputValue() === 'キーバー', 'a leading > switches to commands');
    await input.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(n => document.querySelectorAll('.input-bar.input-always').length === n, alwaysBefore);
    check(!await dialog.isVisible(), 'the toggled command runs again from the > prefix');
    await page.keyboard.press('Alt+/');
    const shortcuts = page.getByRole('dialog', { name: 'ショートカット一覧', exact: true });
    await shortcuts.waitFor();
    check(await shortcuts.getByText('Alt+Shift+P', { exact: true }).count() === 1, 'the shortcut list includes the palette keys');
    await page.keyboard.press('Escape');
    await shortcuts.waitFor({ state: 'hidden' });
    assert.deepEqual(failures, [], scene.name + ' keyboard and live state failures');
    console.log(scene.name + ': composition, focus, device search, scrolling, reordering and live removal passed');
  };
};
