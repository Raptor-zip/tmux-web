const assert = require('node:assert/strict');
const { join } = require('node:path');

/**
 * SIDEBAR_CHECK：一覧（サイドバー）の見出しと行メニュー。
 * - 見出しは 検索欄 / ＋ 新規 ▾ / ⋯。『その他・検索…』、上端の並べ方の切り替え、全体の『片付ける』は無い
 * - ⋯ の『並べ方 ▸』で tw.groupBy が変わる
 * - デバイス見出しは折りたたみと ⋯（ここで新規 ▸ / リモートデスクトップを開く / このデバイスを選ぶ / 接続設定…）
 * - 行の ⋯・右クリック・長押しで行メニュー。『別のセッションへ移す ▸』『別のセッションとまとめる ▸』は
 *   ドラッグと同じ moveWindow / mergeSession を送る。『のぞく』はシートでペインの中身を出す
 * - ドラッグでの移動も残っている
 * - 行の高さは 36px（タッチでは 44px）。行の ⋯ はマウスではホバーのときだけ、タッチでは常に見える
 */
module.exports = async function checkSidebar(page, { scene, out, requests, screenshots }) {
  const touch = !!scene.touch;
  const sidebar = page.locator('.sidebar');
  const menu = page.getByRole('menu').first();
  // ショートカットのヒント（Alt+T など）は項目名の末尾に入るので、ヒントの付く項目は前方一致で探す
  const item = name => page.getByRole('menuitem', typeof name === 'string' ? { name, exact: true } : { name });
  const closeMenu = async () => {
    for (let i = 0; i < 3 && await page.getByRole('menu').count(); i++) await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
  };
  const actions = () => requests.filter(r => r.method === 'POST' && r.path.endsWith('/api/action')).map(r => JSON.parse(r.body || '{}'));
  const lastAction = async name => {
    for (let i = 0; i < 40; i++) {
      const found = actions().filter(a => a.action === name).at(-1);
      if (found) return found;
      await page.waitForTimeout(50);
    }
    assert.fail(`no ${name} request was sent`);
  };
  const longPress = async locator => {
    const box = await locator.boundingBox();
    const point = { x: Math.round(box.x + Math.min(box.width / 2, 80)), y: Math.round(box.y + box.height / 2) };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(800);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };
  /** 行の ⋯。マウスではホバーしたときだけ出る */
  const openMore = async (row, name) => {
    if (!touch) await row.hover();
    await row.getByRole('button', typeof name === 'string' ? { name, exact: true } : { name }).click();
    await menu.waitFor();
  };
  const shot = async name => { if (screenshots) await page.screenshot({ path: join(out, `${scene.name}-${name}.png`), animations: 'disabled' }); };

  await sidebar.waitFor();
  // ---- 見出し
  assert.equal(await page.locator('.sidebar-more, .group-switch, .ov-clean, .sidebar-foot').count(), 0, 'the old footer, view switch and global clean-up are gone');
  assert.equal(await sidebar.getByText('その他・検索…').count(), 0);
  const filter = sidebar.getByRole('textbox', { name: '一覧を絞り込む', exact: true });
  await filter.waitFor();
  const pad = await filter.evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
  assert.ok(pad >= 24, `the filter leaves room for its search icon (padding-left ${pad})`);
  const newButton = sidebar.getByRole('button', { name: '新規', exact: true });
  const listMenu = sidebar.getByRole('button', { name: '一覧の操作', exact: true });
  await newButton.waitFor();
  await listMenu.waitFor();

  // 検索欄で絞り込み、Esc で消す
  await filter.fill('billing');
  await page.waitForTimeout(100);
  const groups = await sidebar.locator('.group-label .name').allTextContents();
  assert.ok(groups.length > 0 && groups.every(n => n === 'billing-service'), `filtering keeps only billing rows (${groups})`);
  await filter.press('Escape');
  assert.equal(await filter.inputValue(), '', 'Escape clears the filter');

  // ---- ＋ 新規 ▾：選択中のデバイスの新規メニュー
  await newButton.click();
  await menu.waitFor();
  assert.equal(await menu.getAttribute('aria-label'), '新規 · ThinkPad', 'the new menu targets the selected device');
  for (const name of [/^端末/, 'プロジェクトを作る…', 'フォルダーを開く…', '過去の会話を再開…', 'tmux セッションを作る…']) await item(name).waitFor();
  await closeMenu();

  // ---- ⋯：一覧の操作
  await listMenu.click();
  await menu.waitFor();
  for (const name of ['並べ方', '未使用の端末を片付ける…', 'すべて折りたたむ', 'デバイス接続を管理…', '表示と接続…', /^一覧を閉じる/]) await item(name).waitFor();
  assert.equal(await item('未使用の端末を片付ける…').isDisabled(), true, 'clean-up is disabled when nothing can be closed');
  await shot('list-menu');
  // すべて折りたたむ → グループの中の行が消える
  await item('すべて折りたたむ').click();
  await menu.waitFor({ state: 'detached' });
  assert.equal(await sidebar.locator('.window-row').count(), 0, 'collapse all hides every terminal row');
  await listMenu.click();
  await item('すべて広げる').click();
  await sidebar.locator('.window-row').first().waitFor();
  // 並べ方 ▸ セッション別
  await listMenu.click();
  await item('並べ方').click();
  await item('セッション別').click();
  await menu.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => localStorage.getItem('tw.groupBy')), '"session"', 'the view is saved to tw.groupBy');
  const localSessions = sidebar.locator('.device-group').first().locator('.session-row');
  await localSessions.filter({ hasText: 'notes' }).first().waitFor();

  // ---- 行の大きさと ⋯
  const row = sidebar.locator('.device-group').first().locator('.window-row[data-window-id="@3"]');
  await row.waitFor();
  const height = (await row.boundingBox()).height;
  if (touch) assert.ok(height >= 44, `touch rows are at least 44px (${height})`);
  else assert.ok(height >= 35 && height <= 37, `rows are 36px (${height})`);
  // 隠れている間は読み上げにも出ないので、class で探す
  const more = row.locator('.row-more');
  if (touch) assert.equal(await more.evaluate(el => getComputedStyle(el).visibility), 'visible', 'the row ⋯ is always shown on touch');
  else {
    await page.mouse.move(5, 5);
    assert.equal(await more.evaluate(el => getComputedStyle(el).visibility), 'hidden', 'the row ⋯ is hidden until hover');
    await row.locator('.window-label').hover();
    let shown = '';
    for (let i = 0; i < 20 && (shown = await more.evaluate(el => getComputedStyle(el).visibility)) !== 'visible'; i++) await page.waitForTimeout(50);
    assert.equal(shown, 'visible', 'hovering shows the row ⋯');
  }

  // ---- 行メニュー（端末の行）：右クリック（タッチは長押し）
  if (touch) await longPress(row.locator('.window-label'));
  else await row.locator('.window-label').click({ button: 'right' });
  await menu.waitFor();
  for (const name of ['タブで開く', '右に並べて開く', '下に並べて開く', 'のぞく', '名前を変更…', '別のセッションへ移す', '端末を終了…']) await item(name).waitFor();
  await shot('row-menu');
  // のぞく：シートでペインの中身を出す
  await item('のぞく').click();
  const peek = page.getByRole('dialog', { name: /^のぞく · / });
  await peek.waitFor();
  await peek.getByText('sidebar-capture: ok').waitFor();
  await shot('peek');
  await peek.getByRole('button', { name: '閉じる', exact: true }).click();
  await peek.waitFor({ state: 'detached' });

  // 別のセッションへ移す ▸ notes：ドラッグで notes の行に落としたときと同じ moveWindow
  await openMore(row, /の操作$/);
  await item('別のセッションへ移す').click();
  await item('notes').click();
  const moved = await lastAction('moveWindow');
  assert.deepEqual(moved.params, { target: '@3', session: '$2' }, 'moving from the menu sends the same moveWindow as a drag');

  // ---- 行メニュー（セッションの行）：別のセッションとまとめる ▸ → 確認 → mergeSession
  const notes = localSessions.filter({ hasText: 'notes' }).first();
  await openMore(notes, '「notes」の操作');
  for (const name of ['タブで開く', 'ここに新しい端末', '名前を変更…', '別のセッションとまとめる', 'tmux セッションを終了…']) await item(name).waitFor();
  assert.equal(await item('端末を終了…').count(), 0, 'session rows do not offer the terminal kill');
  await item('別のセッションとまとめる').click();
  await item('development…').click();
  const confirm = page.getByRole('dialog').filter({ hasText: 'まとめますか' });
  await confirm.waitFor();
  await confirm.getByRole('button', { name: 'まとめる', exact: true }).click();
  const merged = await lastAction('mergeSession');
  assert.deepEqual(merged.params, { source: '$2', target: '$1' }, 'merging from the menu sends the same mergeSession as a drag');

  // tmux セッションの終了は確認つき（最初はキャンセルにフォーカス）
  await openMore(notes, '「notes」の操作');
  await item('tmux セッションを終了…').click();
  const kill = page.getByRole('dialog').filter({ hasText: 'を終了しますか' });
  await kill.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'キャンセル', 'ending a session starts on Cancel');
  await kill.getByRole('button', { name: 'キャンセル', exact: true }).click();
  assert.equal(actions().filter(a => a.action === 'killSession').length, 0);

  // ---- ドラッグの経路も残る（マウスのみ）：端末の行を別のセッション行に落とすと moveWindow
  if (!touch) {
    const before = actions().filter(a => a.action === 'moveWindow').length;
    const from = await sidebar.locator('.device-group').first().locator('.window-row[data-window-id="@4"] .window-label').boundingBox();
    const to = await notes.locator('.group-label').boundingBox();
    await page.mouse.move(from.x + 30, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + from.height / 2 + 10, { steps: 3 });
    await page.mouse.move(to.x + 30, to.y + to.height / 2, { steps: 6 });
    await page.mouse.up();
    for (let i = 0; i < 40 && actions().filter(a => a.action === 'moveWindow').length === before; i++) await page.waitForTimeout(50);
    const dragged = actions().filter(a => a.action === 'moveWindow');
    assert.equal(dragged.length, before + 1, 'dragging a row onto another session still moves it');
    assert.deepEqual(dragged.at(-1).params, { target: '@4', session: '$2' });
  }

  // ---- デバイス見出し
  const spark = sidebar.locator('.device-group').nth(1);
  const sparkMore = spark.getByRole('button', { name: 'DGX Spark の操作', exact: true });
  await sparkMore.scrollIntoViewIfNeeded();
  await sparkMore.click();
  for (const name of ['ここで新規', 'リモートデスクトップを開く', 'このデバイスを選ぶ', '接続設定…']) await item(name).waitFor();
  await item('このデバイスを選ぶ').click();
  await menu.waitFor({ state: 'detached' });
  assert.match(await spark.getAttribute('class'), /selected/, 'the chosen device gets the selected band');
  assert.doesNotMatch(await sidebar.locator('.device-group').first().getAttribute('class'), /selected/);
  await newButton.click();
  assert.equal(await menu.getAttribute('aria-label'), '新規 · DGX Spark', 'the header ＋ 新規 follows the selected device');
  await closeMenu();
  // 選んだデバイスの『このデバイスを選ぶ』は押せない
  await sparkMore.click();
  assert.equal(await item('このデバイスを選ぶ').isDisabled(), true);
  // ここで新規 ▸ は、そのデバイスの新規メニューの中身
  await item('ここで新規').click();
  for (const name of [/^端末/, /^Claude/, /^Codex/, 'プロジェクトを作る…']) await item(name).waitFor();
  await closeMenu();
  // 見出しを押すと折りたたむ
  const toggle = spark.locator('.device-toggle');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await spark.locator('.window-row').count(), 0, 'a collapsed device hides its rows');
  await toggle.click();
  await spark.locator('.window-row').first().waitFor();

  // 並べ方を元に戻す
  await listMenu.click();
  await item('並べ方').click();
  await item('プロジェクト別').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('tw.groupBy')), '"project"');
  console.log(`sidebar header, row menus, device menus and drag passed (${scene.name})`);
};
