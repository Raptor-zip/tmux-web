// Browser clipboard is replaced with an in-memory sink; no host clipboard data.
const assert = require('node:assert/strict');
module.exports = async function checkRemoteClipboard(page, { out, screenshot }) {
  let value = '日本語のコピー\nsecond line\t✓';
  let failure = false;
  let pending = null;
  const requests = [];
  await page.route(/\/desktop\/clipboard$/, async route => {
    requests.push(new URL(route.request().url()).pathname);
    if (pending) await pending;
    await route.fulfill({status: failure ? 503 : 200, contentType:'application/json', body:JSON.stringify(failure ? {error:'クリップボードを読めません'} : {text:value})});
  });
  await page.evaluate(() => {
    window.__clipboardWrites = [];
    window.__clipboardDenied = false;
    window.__clipboardItem = window.ClipboardItem;
    Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{
      async write(items) {
        if (window.__clipboardDenied) throw new DOMException('Denied', 'NotAllowedError');
        const blob = await items[0].getType('text/plain');
        window.__clipboardWrites.push(await blob.text());
      },
      async writeText(text) {
        if (window.__clipboardDenied) throw new DOMException('Denied', 'NotAllowedError');
        window.__clipboardWrites.push(text);
      },
    }});
  });
  // 『接続先からコピー』は画面メニュー（ダイアログの ⋯）から。文字入力の小窓にも同じボタンがある
  const dialog = page.getByRole('dialog', {name:'リモートデスクトップ',exact:true});
  const menu = async name => { await dialog.getByRole('button', {name:'画面の操作',exact:true}).click(); await page.getByRole('menuitem', {name, exact:true}).click(); };
  const copy = () => page.locator('.desktop-clipboard').getByRole('button', {name:'接続先からコピー',exact:true});
  const copyClick = () => menu('接続先からコピー');
  const notice = page.locator('.desktop-notice');
  const writes = () => page.evaluate(() => window.__clipboardWrites);
  await copyClick();
  await notice.filter({hasText:'この端末のクリップボードにコピーしました'}).waitFor();
  assert.deepEqual(await writes(), [value], 'Unicode, newline and tab survive copy');
  assert.equal(await page.locator('.desktop-clipboard textarea').count(), 0, 'direct copy needs no input panel');
  assert.equal(requests.at(-1), '/api/desktop/clipboard');

  await menu('見るだけ');
  await page.getByLabel('接続先', {exact:true}).selectOption('spark');
  value = 'Sparkの文字';
  await copyClick();
  await notice.filter({hasText:'この端末のクリップボードにコピーしました'}).waitFor();
  assert.equal(requests.at(-1), '/api/devices/spark/proxy/api/desktop/clipboard', 'reads selected device');
  assert.equal((await writes()).at(-1), value, 'view-only mode also permits copying');

  await page.evaluate(() => { window.__clipboardDenied = true; });
  value = '手動コピー用の日本語';
  await copyClick();
  await notice.filter({hasText:'自動コピーが許可されていません'}).waitFor();
  const input = page.locator('.desktop-clipboard textarea');
  assert.equal(await input.inputValue(), value);
  await page.waitForFunction(() => {
    const el = document.querySelector('.desktop-clipboard textarea');
    return document.activeElement === el && el.selectionEnd === el.value.length && el.selectionStart === 0;
  });
  if (screenshot) await page.screenshot({path:require('node:path').join(out,'remote-copy-fallback.png'),animations:'disabled'});
  const count = (await writes()).length;
  assert.equal(count, 2, 'denied clipboard leaves previous contents intact');

  await page.evaluate(() => { window.__clipboardDenied = false; });
  value = '';
  await copyClick();
  await notice.filter({hasText:'クリップボードに文字がありません'}).waitFor();
  assert.equal((await writes()).length, count, 'empty clipboard does not clear local contents');

  failure = true;
  await copyClick();
  await notice.filter({hasText:'クリップボードを読めません'}).waitFor();
  assert.equal((await writes()).length, count, 'API failure does not overwrite local contents');
  failure = false;

  await page.evaluate(() => { window.ClipboardItem = undefined; });
  value = 'writeText対応ブラウザ';
  await copyClick();
  await notice.filter({hasText:'この端末のクリップボードにコピーしました'}).waitFor();
  assert.equal((await writes()).at(-1), value);
  await page.evaluate(() => { window.ClipboardItem = window.__clipboardItem; });

  const beforeSwitch = (await writes()).length;
  let release;
  pending = new Promise(resolve => { release = resolve; });
  const previousRequests = requests.length;
  // 文字入力の小窓の『接続先からコピー』から（押している間は『コピー中…』）
  if (!(await copy().count())) await dialog.getByRole('button', {name:'文字入力',exact:true}).click();
  await copy().click();
  await page.getByRole('button', {name:'コピー中…',exact:true}).first().waitFor();
  // Wait until the request is held at the API boundary, then change device.
  for (let i = 0; requests.length === previousRequests && i < 50; i++) await page.waitForTimeout(10);
  assert.equal(requests.length, previousRequests + 1);
  await page.getByLabel('接続先', {exact:true}).selectOption('local');
  await page.getByLabel('接続先', {exact:true}).selectOption('spark');
  release(); pending = null;
  await copy().waitFor();
  assert.equal((await writes()).length, beforeSwitch, 'stale response cannot copy even after switching back to the original device');
  assert.equal(await notice.count(), 0, 'stale response does not report success');
  assert.equal(await dialog.locator('.screen-badge', {hasText:'見るだけ'}).count(), 1, 'view-only survives switching the device');
  await menu('操作する');
  assert.equal(await dialog.locator('.screen-badge').count(), 0);
  await menu('原寸で表示');
  await dialog.getByRole('button', {name:'画面の操作',exact:true}).click();
  assert.equal(await page.getByRole('menuitem', {name:'画面に合わせる',exact:true}).count(), 1, 'the fit item flips after choosing actual size');
  await page.keyboard.press('Escape');

  // お知らせは 5 秒で消える
  value = '消えるお知らせ';
  await copyClick();
  await notice.filter({hasText:'この端末のクリップボードにコピーしました'}).waitFor();
  await notice.waitFor({state:'detached', timeout:7000});
  console.log('remote clipboard: Unicode, selected device, view-only, denial, empty, API error, writeText, stale response and notice timeout passed');
};
