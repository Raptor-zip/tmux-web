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
  // 画面タブの状態は、タイル見出しの差し込み口（.strip-screen）に出る。スマホの見出し 1 行では画面の右上に重ねる
  const head = page.locator('.tile .strip-screen');
  const connected = () => page.locator('.tile .strip-screen .desktop-connection-status.is-connected, .screen-tab-view:not([hidden]) .screen-float-head .desktop-connection-status.is-connected').first().waitFor({ timeout: 8000 }).catch(async error => {
    console.error('screen state:', await page.locator('.screen-tab-view, .desktop-viewer').evaluateAll(views => views.map(v => ({ hidden: v.hidden, text: v.innerText.slice(0, 600).replace(/\n/g,' / ') }))));
    console.error('transports:', screenTransports.map(t => ({ closed: t.closed, framed: !!t.framed, keys: t.keys.length })));
    throw error;
  });
  const plusMenu = async () => {
    await page.locator('.tile.focused').getByRole('button', { name: '新規メニュー', exact: true }).click();
    await page.getByRole('menuitem', { name: 'リモートデスクトップ', exact: true }).click();
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

  // 「＋▾ → リモートデスクトップ ▸」から開く。端末のタブと同じ列にモニタのアイコン付きで並ぶ
  await plusMenu();
  await page.getByRole('menuitem', { name: /^ThinkPad/ }).click();
  await connected();
  assert.equal(await shown.locator('.desktop-viewport canvas').count(), 1, 'the remote screen renders inside the tile');
  assert.equal(open().length, 1);
  assert.equal(await page.locator('.tab.tab-screen').count(), 1);
  assert.match(await page.locator('.tab.tab-screen.active .tab-name').textContent(), /ThinkPad/);
  assert.equal(await page.locator('.panel-connection:visible').count(), 0, 'the terminal reconnect overlay is not stacked on the screen');
  await waitFor(() => (workspace().values['tw.layout'] || '').includes('"kind":"screen"'), 'the screen tab is saved to the synced layout');
  assert.equal(await page.locator('.input-bar:visible').count(), 0, 'terminal input bar is hidden for a screen tab');

  // 見出しは 1 段：状態・⌨・Esc はタイル見出しに入り、画面の上に 2 段目のツールバーは無い
  assert.equal(await shown.locator('.desktop-compact-head').count(), 0, 'no second toolbar row above the screen');
  assert.equal(await head.getByRole('button', { name: '文字入力', exact: true }).count(), 1);
  const stripBox = await page.locator('.tile.focused .tabstrip').boundingBox();
  const stageBox = await shown.locator('.desktop-stage').boundingBox();
  assert.ok(stageBox.y - (stripBox.y + stripBox.height) <= 1, 'the screen starts right below the tile header');
  const sentKeys = () => open()[0].keys;
  const before16 = sentKeys().length;
  await head.getByRole('button', { name: 'Esc を送る', exact: true }).click();
  await waitFor(() => sentKeys().slice(before16).some(k => k.key === 0xff1b && k.down), 'Esc in the header reaches the remote');
  // 画面メニューはタブメニューの先頭の段
  await page.locator('.tile.focused').getByRole('button', { name: 'タブの操作', exact: true }).click();
  const menuNames = await page.getByRole('menu').first().getByRole('menuitem').allTextContents();
  assert.match(menuNames[0], /^見るだけ/, 'the screen menu comes first: ' + menuNames.join(','));
  for (const name of ['原寸で表示', '接続先からコピー', '再接続', 'ダイアログで大きく表示', '画質…', '操作ガイドと接続情報']) {
    assert.ok(menuNames.some(t => t.startsWith(name)), `screen menu has ${name}: ${menuNames.join(',')}`);
  }
  await page.getByRole('menuitem', { name: '見るだけ', exact: true }).click();
  await head.getByText('見るだけ', { exact: true }).waitFor();
  assert.equal(await head.getByRole('button', { name: 'Esc を送る', exact: true }).isDisabled(), true, 'view-only does not send keys');
  await page.locator('.tile.focused').getByRole('button', { name: 'タブの操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '操作する', exact: true }).click();
  assert.equal(await head.getByText('見るだけ', { exact: true }).count(), 0);
  // 画質はモーダル。プリセットはラジオで、今の設定に印が付く
  await page.locator('.tile.focused').getByRole('button', { name: 'タブの操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '画質…', exact: true }).click();
  const quality = page.getByRole('dialog', { name: '画質', exact: true });
  await quality.waitFor();
  assert.equal(await quality.getByRole('radio', { name: /バランス/ }).isChecked(), true);
  assert.match(await quality.locator('.screen-preset', { hasText: 'バランス' }).textContent(), /使用中/);
  await quality.getByRole('radio', { name: /低遅延/ }).check();
  await quality.getByRole('button', { name: 'キャンセル', exact: true }).click();
  assert.equal(await quality.count(), 0);
  assert.equal(screenTransports.length, 1, 'cancelling the quality dialog does not reconnect');
  // 文字入力：Esc で閉じて ⌨ へ戻る。キーとして送ると 1 文字ずつ届く。お知らせは × で閉じられる
  await head.getByRole('button', { name: '文字入力', exact: true }).click();
  const draft = shown.locator('.desktop-clipboard textarea');
  await draft.fill('ab');
  await page.keyboard.press('Escape');
  assert.equal(await draft.count(), 0, 'Escape closes the text input first');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '文字入力');
  assert.equal(await shown.count(), 1, 'Escape did not leave the screen tab');
  await head.getByRole('button', { name: '文字入力', exact: true }).click();
  assert.equal(await draft.inputValue(), 'ab', 'the draft survives closing');
  const before17 = sentKeys().length;
  await shown.getByRole('button', { name: 'キーとして送る', exact: true }).click();
  await waitFor(() => { const ks = sentKeys().slice(before17).filter(k => k.down).map(k => k.key); return ks.includes(0x61) && ks.includes(0x62); }, 'typed text reaches the remote as keys');
  const notice = shown.locator('.desktop-notice');
  await notice.filter({ hasText: 'キーとして送りました' }).waitFor();
  await shown.getByRole('button', { name: 'お知らせを閉じる', exact: true }).click();
  assert.equal(await notice.count(), 0, 'the notice closes with ×');
  await shown.getByRole('button', { name: '文字入力を閉じる', exact: true }).click();

  // 同じデバイスをもう一度開いても 2 枚目は作らず、接続も増やさない
  await plusMenu();
  await page.getByRole('menuitem', { name: /^ThinkPad/ }).click();
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
  await plusMenu();
  await page.getByRole('menuitem', { name: 'ダイアログで開く', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'リモートデスクトップ', exact: true });
  await dialog.locator('.desktop-connection-status.is-connected').waitFor({ timeout: 8000 });
  await waitFor(() => open().length === 1 && screenTransports[0].closed, 'the dialog takes over the only connection');
  await shown.getByText('別の場所で表示中', { exact: true }).first().waitFor();
  await dialog.getByRole('button', { name: 'リモートデスクトップを閉じる', exact: true }).click();
  await connected();
  await waitFor(() => open().length === 1, 'closing the dialog hands the connection back to the visible tab');

  // ダイアログの ⋯ →『タブに戻す』は、既存のタブを前に出してダイアログを閉じる
  await page.locator('.tab:not(.tab-screen)').first().click();
  await plusMenu();
  await page.getByRole('menuitem', { name: 'ダイアログで開く', exact: true }).click();
  await dialog.getByRole('button', { name: '画面の操作', exact: true }).click();
  await page.getByRole('menuitem', { name: 'タブに戻す', exact: true }).click();
  assert.equal(await dialog.count(), 0);
  assert.equal(await page.locator('.tab.tab-screen').count(), 1);
  await connected();
  await waitFor(() => open().length === 1, 'exactly one connection after returning to the tab');

  // 右に分割して移すと、端末と画面を並べて同時に見られる
  await page.locator('.tab.tab-screen').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '配置', exact: true }).click();
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
  // タイル見出しが隠れても、状態は画面の右上に見えている（⌨ と Esc は入力行）
  assert.ok(await shown.locator('.screen-float-head .desktop-connection-status').isVisible(), 'the connection state stays visible on phones');
  // スマホでは入力行が画面用のキーになる。Ctrl を押したままにして Esc を押すと、Ctrl+Esc が届いて Ctrl は離れる
  const bar = page.locator('.screen-input-bar');
  await bar.waitFor();
  assert.deepEqual(await bar.locator('.input-keys button').allTextContents(), ['Esc', 'Tab', '↑', '↓', '←', '→', 'Enter', 'Ctrl', 'Alt']);
  const live = open().at(-1);
  const from = live.keys.length;
  await bar.getByRole('button', { name: 'Ctrl', exact: true }).click();
  assert.equal(await bar.getByRole('button', { name: 'Ctrl', exact: true }).getAttribute('aria-pressed'), 'true');
  await bar.getByRole('button', { name: 'Ctrl+Esc', exact: true }).click();
  await waitFor(() => live.keys.slice(from).filter(k => !k.down).some(k => k.key === 0xffe3), 'Ctrl is released after the key');
  assert.deepEqual(live.keys.slice(from).map(k => `${k.key.toString(16)}${k.down ? 'v' : '^'}`), ['ffe3v', 'ff1bv', 'ff1b^', 'ffe3^']);
  assert.equal(await bar.getByRole('button', { name: 'Ctrl', exact: true }).getAttribute('aria-pressed'), 'false');
  // ［⌨ 文字入力］で、画面の下端に文字入力が開く
  await bar.getByRole('button', { name: '文字入力', exact: true }).click();
  await shown.locator('.desktop-clipboard textarea').waitFor();
  await page.keyboard.press('Escape');
  // 見るだけのバッジもスマホで見える。入力行を隠していても、⋯ の画面メニューから文字入力を開ける
  await page.locator('.phone-more').click();
  await page.getByRole('menuitem', { name: '見るだけ', exact: true }).click();
  await shown.locator('.screen-float-head .screen-badge', { hasText: '見るだけ' }).waitFor();
  await page.locator('.phone-more').click();
  await page.getByRole('menuitem', { name: '操作する', exact: true }).click();
  await page.locator('.phone-more').click();
  await page.getByRole('menuitem', { name: '文字入力', exact: true }).click();
  await shown.locator('.desktop-clipboard textarea').waitFor();
  await page.keyboard.press('Escape');
  console.log('screen tab: one-row header, Esc, screen menu, view-only badge, quality dialog, text input and notice, phone screen keys, open from tab strip, dedupe, synced layout, Ctrl+wheel, Alt release, grace period, dialog handover, open-as-tab, split view and idle disconnect passed');
};
