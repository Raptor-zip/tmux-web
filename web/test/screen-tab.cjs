const assert = require('node:assert/strict');
const { join } = require('node:path');

// SCREEN_TAB_CHECK=1：リモートデスクトップをタブとして開き、端末と並べて使えることを確かめる。
// 画面はテスト用の最小 RFB サーバ（visual-feedback.cjs）から 320x200 を 1 枚だけ受け取る。
module.exports = async function checkScreenTab(page, { screenTransports, terminalTransports, workspace, out }) {
  const open = () => screenTransports.filter(t => !t.closed);
  const waitFor = async (predicate, message, timeout = 8000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (predicate()) return; await page.waitForTimeout(50); }
    assert.fail(message);
  };
  const shown = page.locator('.screen-tab-view:not([hidden])');
  const connected = () => shown.locator('.desktop-connection-status.is-connected').waitFor({ timeout: 8000 }).catch(async error => {
    console.error('screen state:', await page.locator('.screen-tab-view, .desktop-viewer').evaluateAll(views => views.map(v => ({ hidden: v.hidden, text: v.innerText.slice(0, 600).replace(/\n/g,' / ') }))));
    console.error('transports:', screenTransports.map(t => ({ closed: t.closed, framed: !!t.framed, keys: t.keys.length })));
    throw error;
  });
  const plusMenu = async () => {
    await page.locator('.tile.focused').getByRole('button', { name: '新しい端末をタブで開く', exact: true }).click();
  };

  // Playwright の WebSocket 差し替えは send などを親クラスに持つため、noVNC の
  // 「自分の prototype に必要な口があるか」の検査に落ちる。テストの中だけ口を写しておく
  await page.evaluate(() => {
    const proto = WebSocket.prototype;
    for (const name of ['binaryType', 'protocol', 'readyState', 'close', 'send', 'onerror', 'onmessage', 'onopen']) {
      if (Object.getOwnPropertyNames(proto).includes(name)) continue;
      for (let p = Object.getPrototypeOf(proto); p; p = Object.getPrototypeOf(p)) {
        const descriptor = Object.getOwnPropertyDescriptor(p, name);
        if (descriptor) { Object.defineProperty(proto, name, descriptor); break; }
      }
    }
  });

  // 「+」から開く。端末のタブと同じ列にモニタのアイコン付きで並ぶ
  await plusMenu();
  await page.getByRole('menuitem', { name: 'ThinkPad のリモートデスクトップを開く', exact: true }).click();
  await connected();
  assert.equal(await shown.locator('.desktop-viewport canvas').count(), 1, 'the remote screen renders inside the tile');
  assert.equal(open().length, 1);
  assert.equal(await page.locator('.tab.tab-screen').count(), 1);
  assert.match(await page.locator('.tab.tab-screen.active .tab-name').textContent(), /ThinkPad/);
  assert.equal(await page.locator('.panel-connection:visible').count(), 0, 'the terminal reconnect overlay is not stacked on the screen');
  await waitFor(() => (workspace().values['tw.layout'] || '').includes('"kind":"screen"'), 'the screen tab is saved to the synced layout');
  assert.equal(await page.locator('.mobile-input:visible').count(), 0, 'terminal input bar is hidden for a screen tab');

  // 同じデバイスをもう一度開いても 2 枚目は作らず、接続も増やさない
  await plusMenu();
  await page.getByRole('menuitem', { name: 'ThinkPad のリモートデスクトップを開く', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.tab.tab-screen').count(), 1);
  assert.equal(screenTransports.length, 1, 'reopening the same device does not reconnect');

  // Ctrl+ホイールは端末の文字サイズではなくリモートへ
  const fontBefore = await page.evaluate(() => localStorage.getItem('tw.fontSize'));
  const box = await shown.locator('.desktop-viewport').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -400); await page.keyboard.up('Control');
  assert.equal(await page.evaluate(() => localStorage.getItem('tw.fontSize')), fontBefore, 'Ctrl+wheel over the screen does not zoom terminals');

  // Alt+数字でタブを移っても、リモートで Alt が押されたままにならない
  const first = open()[0];
  await shown.locator('.desktop-viewport canvas').click();
  await page.keyboard.down('Alt');
  await waitFor(() => first.keys.some(k => k.key === 0xffe9 && k.down), 'Alt reaches the remote while the screen has focus');
  await page.keyboard.press('1');
  await page.keyboard.up('Alt');
  await waitFor(() => { const alt = first.keys.filter(k => k.key === 0xffe9); return alt.length && !alt.at(-1).down; }, 'leaving the screen releases Alt on the remote');
  assert.equal(await shown.count(), 0, 'Alt+1 switched to the first terminal tab');

  // 隠しても 30 秒は繋いだまま。戻るとすぐ見える
  await page.waitForTimeout(1000);
  assert.equal(open().length, 1, 'a briefly hidden screen keeps its connection');
  await page.locator('.tab.tab-screen').click();
  await connected();
  assert.equal(screenTransports.length, 1, 'returning within the grace period does not reconnect');

  // ダイアログで同じ画面を開くと、タブは接続を譲って「別の場所で表示中」になる
  await page.locator('.tile.focused').getByRole('button', { name: 'パネルの操作', exact: true }).click();
  await page.getByRole('menuitem', { name: 'リモートデスクトップをダイアログで開く', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'リモートデスクトップ', exact: true });
  await dialog.locator('.desktop-connection-status.is-connected').waitFor({ timeout: 8000 });
  await waitFor(() => open().length === 1 && screenTransports[0].closed, 'the dialog takes over the only connection');
  await shown.getByText('別の場所で表示中', { exact: true }).first().waitFor();
  await dialog.getByRole('button', { name: 'デスクトップを閉じる', exact: true }).click();
  await connected();
  await waitFor(() => open().length === 1, 'closing the dialog hands the connection back to the visible tab');

  // ダイアログの「タブで開く」は、既存のタブを前に出してダイアログを閉じる
  await page.locator('.tab:not(.tab-screen)').first().click();
  await page.locator('.tile.focused').getByRole('button', { name: 'パネルの操作', exact: true }).click();
  await page.getByRole('menuitem', { name: 'リモートデスクトップをダイアログで開く', exact: true }).click();
  await dialog.getByRole('button', { name: 'タブで開く', exact: true }).click();
  assert.equal(await dialog.count(), 0);
  assert.equal(await page.locator('.tab.tab-screen').count(), 1);
  await connected();
  await waitFor(() => open().length === 1, 'exactly one connection after returning to the tab');

  // 右に分割して移すと、端末と画面を並べて同時に見られる
  await page.locator('.tab.tab-screen').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^右に分割して移す/ }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.tile').count(), 2);
  await connected();
  assert.ok(await page.locator('.terminal-host:not([hidden])').count() >= 1, 'a terminal is visible next to the screen');
  assert.ok(await shown.locator('.desktop-viewport canvas').isVisible());
  await page.screenshot({ path: join(out, 'screen-tab-split.png') });

  // 隠したまま 30 秒経つと切断し、もう一度見ると繋ぎ直す
  const before = screenTransports.length;
  // ページを裏へ回して隠す（タブを切り替えて隠したときと同じ経路）
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(2000);
  assert.equal(open().length, 1, 'still connected shortly after hiding');
  await waitFor(() => open().length === 0, 'disconnects after 30 seconds hidden', 35000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await connected();
  assert.equal(screenTransports.length, before + 1, 'showing it again reconnects once');
  assert.ok(terminalTransports.every(t => !t.closed || t.closeEvents), 'terminals are unaffected');
  // スマホ幅では 1 パネル表示になり、画面タブもタブ一覧から選べる
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await connected();
  await page.screenshot({ path: join(out, 'screen-tab-mobile.png') });
  console.log('screen tab: open from tab strip, dedupe, synced layout, Ctrl+wheel, Alt release, grace period, dialog handover, open-as-tab, split view and idle disconnect passed');
};
