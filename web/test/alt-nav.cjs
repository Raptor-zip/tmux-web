const assert = require('node:assert/strict');

// Alt+数字・Alt+[ ]・Alt+J・Alt+O（ステップ9）。laptop-four：4 パネル、入力先は panel-local-1（tab-local-1, tab-local-5）
module.exports = async function altNav(page, { terminalInputs }) {
  const selected = () => page.locator('.tile.focused [role=tab][aria-selected=true]').getAttribute('data-tab-id');
  const press = async key => { await page.keyboard.press(key); await page.waitForTimeout(120); };
  assert.equal(await page.locator('.tile:visible').count(), 4, 'starts split');
  assert.equal(await selected(), 'tab-local-1');

  // 分割表示：入力先のパネルの中で数える
  await press('Alt+2');
  assert.equal(await selected(), 'tab-local-5', 'Alt+2 picks the second tab of the focused panel');
  await press('Alt+1');
  assert.equal(await selected(), 'tab-local-1');
  await press('Alt+0');
  assert.equal(await selected(), 'tab-local-5', 'Alt+0 picks the last tab of the focused panel');
  await press('Alt+]');
  assert.equal(await selected(), 'tab-local-1', 'Alt+] wraps inside the focused panel');
  await press('Alt+[');
  assert.equal(await selected(), 'tab-local-5');
  await press('Alt+1');

  // 1 パネル表示：ワークスペース全体の順（タブ列と同じ）で数える
  await press('Alt+Enter');
  assert.equal(await page.locator('.tile:visible').count(), 1, 'Alt+Enter maximizes');
  const strip = await page.locator('.tile:visible [role=tab]').evaluateAll(tabs => tabs.map(t => t.getAttribute('data-tab-id')));
  assert.deepEqual(strip, ['tab-local-1', 'tab-local-5', 'tab-local-2', 'tab-spark-1', 'tab-local-3'], 'the single-panel strip lists the whole workspace');
  await press('Alt+3');
  assert.equal(await selected(), 'tab-local-2', 'Alt+3 counts across panels in single-panel view');
  await press('Alt+]');
  assert.equal(await selected(), 'tab-spark-1', 'Alt+] crosses into the next panel');
  await press('Alt+0');
  assert.equal(await selected(), 'tab-local-3', 'Alt+0 picks the last tab of the workspace');
  await press('Alt+]');
  assert.equal(await selected(), 'tab-local-1', 'Alt+] wraps to the first tab of the workspace');
  await press('Alt+[');
  assert.equal(await selected(), 'tab-local-3');
  assert.equal(await page.locator('.tile:visible').count(), 1, 'still single-panel after switching');
  await press('Alt+1');
  await press('Alt+Enter');
  assert.equal(await page.locator('.tile:visible').count(), 4, 'back to split');

  // Alt+J：入力待ち（@2, @3, @5, @6 …）を順に回る。開いていればそのタブへ、なければ入力先のパネルに開く
  const focusedWindow = () => page.locator('.tile.focused [role=tab][aria-selected=true]').getAttribute('data-tab-id');
  await press('Alt+J');
  assert.equal(await focusedWindow(), 'tab-local-2', 'Alt+J goes to the first waiting terminal');
  await press('Alt+J');
  assert.equal(await focusedWindow(), 'tab-local-3');
  await press('Alt+J');
  assert.equal(await focusedWindow(), 'tab-local-5');
  const before = await page.locator('[role=tab]').count();
  await press('Alt+J');
  assert.equal(await page.locator('[role=tab]').count(), before + 1, 'Alt+J opens a waiting terminal that has no tab yet');
  assert.match(await page.locator('.tile.focused [role=tab][aria-selected=true] .tab-name').textContent(), /\S/);

  // Alt+O：作業フォルダー
  await press('Alt+O');
  const files = page.getByRole('dialog', { name: 'ファイル一覧とプレビュー' });
  await files.waitFor();
  await page.keyboard.press('Escape');
  await files.waitFor({ state: 'detached' });

  // ショートカット一覧に載る
  await press('Alt+/');
  const list = page.getByRole('dialog', { name: 'ショートカット一覧' });
  await list.waitFor();
  for (const keys of ['Alt+J', 'Alt+O']) assert.equal(await list.locator('kbd', { hasText: keys }).count(), 1, keys + ' is listed');
  await page.keyboard.press('Escape');
  await list.waitFor({ state: 'detached' });

  // タブメニューの『作業フォルダーを開く』に Alt+O が出る
  await page.locator('.tile.focused').getByRole('button', { name: 'タブの操作', exact: true }).click();
  assert.equal(await page.getByRole('menuitem', { name: /^作業フォルダーを開く/ }).locator('.ctx-key').textContent(), 'Alt+O');
  await page.keyboard.press('Escape');

  // tw.altKeys をオフにすると、Alt+J / Alt+O / Alt+数字 は端末へ届き、アプリは動かない
  await page.evaluate(() => { localStorage.setItem('tw.altKeys', 'false'); window.dispatchEvent(new StorageEvent('storage', { key: 'tw.altKeys' })); });
  await page.waitForTimeout(100);
  await page.locator('.tile.focused .terminal-host:visible').click({ position: { x: 60, y: 60 } });
  const tab = await selected();
  const inputs = terminalInputs.length;
  await press('Alt+J');
  await press('Alt+1');
  assert.equal(await selected(), tab, 'with Alt shortcuts off the app ignores Alt+J / Alt+1');
  assert.equal(await files.count(), 0, 'Alt+O does not open files when off');
  await press('Alt+O');
  assert.equal(await files.count(), 0);
  assert.ok(terminalInputs.slice(inputs).join('').includes('\x1bj'), 'Alt+J reaches the terminal as ESC j: ' + JSON.stringify(terminalInputs.slice(inputs)));
  await page.evaluate(() => { localStorage.setItem('tw.altKeys', 'true'); window.dispatchEvent(new StorageEvent('storage', { key: 'tw.altKeys' })); });
};
