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
  const copy = () => page.getByRole('button', {name:'この端末へコピー',exact:true});
  const openControls = async () => {
    const toggle = page.getByRole('button', {name:'操作・設定',exact:true});
    if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  };
  const copyClick = async () => { await openControls(); await copy().click(); };
  const notice = page.locator('.desktop-notice');
  const writes = () => page.evaluate(() => window.__clipboardWrites);
  await copyClick();
  await notice.filter({hasText:'この端末のクリップボードにコピーしました'}).waitFor();
  assert.deepEqual(await writes(), [value], 'Unicode, newline and tab survive copy');
  assert.equal(await page.locator('#desktop-text').count(), 0, 'direct copy needs no input panel');
  assert.equal(requests.at(-1), '/api/desktop/clipboard');

  await page.getByRole('button', {name:'見るだけ',exact:true}).click();
  await page.getByLabel('デスクトップのデバイス', {exact:true}).selectOption('spark');
  value = 'Sparkの文字';
  await copyClick();
  await notice.filter({hasText:'この端末のクリップボードにコピーしました'}).waitFor();
  assert.equal(requests.at(-1), '/api/devices/spark/proxy/api/desktop/clipboard', 'reads selected device');
  assert.equal((await writes()).at(-1), value, 'view-only mode also permits copying');

  await page.evaluate(() => { window.__clipboardDenied = true; });
  value = '手動コピー用の日本語';
  await copyClick();
  await notice.filter({hasText:'自動コピーが許可されていません'}).waitFor();
  const input = page.locator('#desktop-text');
  assert.equal(await input.inputValue(), value);
  await page.waitForFunction(() => {
    const el = document.getElementById('desktop-text');
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
  await copyClick();
  await page.getByRole('button', {name:'コピー中…',exact:true}).first().waitFor();
  // Wait until the request is held at the API boundary, then change device.
  for (let i = 0; requests.length === previousRequests && i < 50; i++) await page.waitForTimeout(10);
  assert.equal(requests.length, previousRequests + 1);
  await page.getByLabel('デスクトップのデバイス', {exact:true}).selectOption('local');
  await page.getByLabel('デスクトップのデバイス', {exact:true}).selectOption('spark');
  release(); pending = null;
  await copy().waitFor();
  assert.equal((await writes()).length, beforeSwitch, 'stale response cannot copy even after switching back to the original device');
  assert.equal(await notice.count(), 0, 'stale response does not report success');
  assert.equal(await page.getByRole('button',{name:'見るだけ',exact:true}).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button',{name:'操作する',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'操作する',exact:true}).getAttribute('aria-pressed'), 'true');
  await page.getByLabel('デスクトップの表示サイズ',{exact:true}).selectOption('actual');
  assert.equal(await page.getByLabel('デスクトップの表示サイズ',{exact:true}).inputValue(), 'actual');
  console.log('remote clipboard: Unicode, selected device, view-only, denial, empty, API error, writeText and stale response passed');
};
