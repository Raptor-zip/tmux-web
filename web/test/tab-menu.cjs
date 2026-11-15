const assert = require('node:assert/strict');
const { join } = require('node:path');

/**
 * TAB_MENU_CHECK：タブメニュー（タブの右クリック・長押し・⋯、端末の右クリック・長押し）。
 * - マウス：サブメニューがホバーとキーボード（→ / ← / Esc）で開閉する
 * - タッチ：タブと端末の長押しで同じメニューがシートで開き、サブメニューはシートの中で切り替わる
 * - 『テキストを選んでコピー…』で全文がふつうの文字として出る
 */
module.exports = async function checkTabMenu(page, { scene, out, touch }) {
  const menu = page.getByRole('menu').first();
  const item = name => page.getByRole('menuitem', { name, exact: true });
  const closeMenu = async () => { await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' }); };
  const activeName = () => page.locator('.tile:visible .tab.active .tab-name').first().textContent();

  /** CDP で指を 1 本置いて、しばらくしてから離す（長押し） */
  const longPress = async locator => {
    const box = await locator.boundingBox();
    const point = { x: Math.round(box.x + Math.min(box.width / 2, 60)), y: Math.round(box.y + box.height / 2) };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(800);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };

  if (!touch) {
    // 見出しの ⋯ は『タブの操作』。前面のタブのメニューを、タブ名を見出しにして開く
    await page.locator('.tile.focused').getByRole('button', { name: 'タブの操作', exact: true }).click();
    assert.equal(await menu.getAttribute('aria-label'), await activeName(), 'the tab menu is titled with its tab');
    assert.equal(await item('選択中のタブの操作…').count(), 0, 'the nested "selected tab" menu is gone');
    // ホバーで右に開く
    await item('配置').hover();
    await item('右に分割して移す').waitFor();
    const parent = await item('配置').boundingBox();
    const child = await item('右に分割して移す').boundingBox();
    // 右に開く。画面の右端で入らないときは左に開く（どちらでも親と重ならない）
    assert.ok(child.x >= parent.x + parent.width - 4 || child.x + child.width <= parent.x + 4, 'the submenu opens beside its parent');
    await page.screenshot({ path: join(out, 'tab-menu-submenu.png'), animations: 'disabled' });
    // 別の項目に乗ると閉じる
    await item('全文をコピー（履歴込み）').hover();
    await item('右に分割して移す').waitFor({ state: 'detached' });
    // キーボード：→ で開いて先頭へ、← で戻る、Esc は 1 段だけ戻る
    await item('tmux').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.activeElement?.textContent?.includes('端末の名前を変更'));
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.activeElement?.textContent?.startsWith('tmux'));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    assert.equal(await menu.count(), 1, 'Escape in a submenu only closes the submenu');
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });

    // 裏のタブを右クリックすると、そのタブのメニュー。前面にないので貼り付けは理由つきで押せない
    const back = page.locator('.tile:visible .tab:not(.active)').first();
    const backName = await back.locator('.tab-name').textContent();
    await back.click({ button: 'right' });
    assert.equal(await menu.getAttribute('aria-label'), backName, 'right-clicking a background tab targets that tab');
    const paste = page.getByRole('menuitem', { name: /^貼り付け/ });
    assert.equal(await paste.isDisabled(), true);
    assert.match(await paste.getAttribute('title'), /前面/);
    await item('まとめて閉じる').click();
    await page.getByRole('menuitem', { name: /^他のタブ（\d+）$/ }).waitFor();
    await closeMenu();

    // Shift+F10 でもタブメニュー
    await page.locator('.tile:visible .tab.active').focus();
    await page.keyboard.press('Shift+F10');
    assert.equal(await menu.getAttribute('aria-label'), await activeName());
    await closeMenu();
  } else {
    // タブの長押し
    await longPress(page.locator('.tile:visible .tab.active'));
    await menu.waitFor();
    assert.equal(await menu.getAttribute('aria-label'), await activeName(), 'long-pressing a tab opens its menu');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'menuitem', 'the long press does not steal focus back to the tab');
    // サブメニューはシートの中で切り替わり、『‹ 戻る』で戻る
    await item('配置').click();
    await item('‹ 戻る').waitFor();
    assert.equal(await menu.getAttribute('aria-label'), '配置');
    await page.screenshot({ path: join(out, 'tab-menu-sheet-submenu.png'), animations: 'disabled' });
    await item('‹ 戻る').click();
    await item('配置').waitFor();
    await page.getByRole('button', { name: 'メニューを閉じる', exact: true }).click();
    await menu.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.tab-menu').count(), 0, 'the per-tab touch ⋯ is gone');

    // 端末の長押しも同じメニュー
    await longPress(page.locator('.tile:visible .terminal-host').first());
    await menu.waitFor();
    assert.equal(await menu.getAttribute('aria-label'), await activeName(), 'long-pressing the terminal opens the tab menu');
    await page.screenshot({ path: join(out, 'tab-menu-terminal-sheet.png'), animations: 'disabled' });
    // テキストを選んでコピー…
    await item('テキストを選んでコピー…').click();
    const sheet = page.getByRole('dialog', { name: 'テキストを選んでコピー', exact: true });
    await sheet.locator('.text-copy-text').waitFor();
    assert.match(await sheet.locator('.text-copy-text').textContent(), /tab-menu-capture/);
    assert.equal(await sheet.locator('.text-copy-text').evaluate(el => getComputedStyle(el).userSelect), 'text', 'the captured text can be selected');
    await page.screenshot({ path: join(out, 'tab-menu-text-copy.png'), animations: 'disabled' });
    await sheet.getByRole('button', { name: '閉じる', exact: true }).click();
    await sheet.waitFor({ state: 'detached' });
  }
  console.log(`tab menu (${scene.name}): submenus, long press and text copy passed`);
};
