const assert = require('node:assert/strict');
const { join } = require('node:path');
module.exports = async function checkDesktopContext(page, { scene, out, screenshots }) {
  assert.equal(await page.locator('.desktop-rename').count(), 0);
  const remote = page.getByRole('button', { name:'リモートデスクトップ', exact:true });
  assert.deepEqual(await remote.evaluate(el => ({ border:getComputedStyle(el).borderTopWidth, background:getComputedStyle(el).backgroundColor })), { border:'0px', background:'rgba(0, 0, 0, 0)' });
  await page.getByRole('button',{name:'デスクトップを追加',exact:true}).click();
  const first = page.locator('.desktop-tab').first();
  const second = page.locator('.desktop-tab').nth(1);
  const activeId = await second.getAttribute('data-desktop-id');
  await first.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120); // Settle the scroll before starting a hold.
  let cdp;
  if (scene.touch && page.context().browser().browserType().name() === 'chromium') {
    cdp = await page.context().newCDPSession(page);
    const b = await first.boundingBox();
    const point = { x:b.x+b.width/2, y:b.y+b.height/2 };
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    await page.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  } else if (scene.touch) {
    await first.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:8,isPrimary:true,button:0,clientX:30,clientY:20});
    await page.waitForTimeout(650);
    await first.dispatchEvent('pointerup',{pointerType:'touch',pointerId:8,isPrimary:true,button:0});
    await first.dispatchEvent('click');
  } else await first.click({button:'right'});
  const edit = page.getByRole('menuitem',{name:'名前を変更…',exact:true});
  await edit.waitFor();
  assert.equal(await second.getAttribute('aria-selected'),'true','opening menu on inactive tab keeps active desktop');
  if (screenshots) await page.screenshot({path:join(out,scene.name+'-menu.png'),animations:'disabled'});
  await edit.click();
  assert.equal(await page.locator('.dialog-input').inputValue(),'デスクトップ1');
  await page.locator('.dialog-input').fill('編集した作業');
  await page.getByRole('button',{name:'変更',exact:true}).click();
  await first.filter({hasText:'編集した作業'}).waitFor();
  assert.equal(await second.getAttribute('aria-selected'),'true');
  await page.waitForFunction(id => { const state=JSON.parse(localStorage.getItem('tw.desktops')); return state.activeId===id && state.items[0].name==='編集した作業'; }, activeId);

  // Movement before the hold threshold cancels the gesture; the following click works.
  await first.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:9,isPrimary:true,button:0,clientX:30,clientY:20});
  await first.dispatchEvent('pointermove',{pointerType:'touch',pointerId:9,isPrimary:true,clientX:60,clientY:20});
  await page.waitForTimeout(650);
  await first.dispatchEvent('pointerup',{pointerType:'touch',pointerId:9,isPrimary:true});
  assert.equal(await page.getByRole('menu').count(),0,'scrolling does not open menu');
  await first.click();
  assert.equal(await first.getAttribute('aria-selected'),'true');
  await first.focus();
  await page.keyboard.press('Shift+F10');
  await edit.waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('menu').count(),0);
  await first.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await second.getAttribute('aria-selected'),'true','arrow-key tab switching remains available');
  await remote.click();
  await page.getByRole('dialog',{name:'リモートデスクトップ',exact:true}).waitFor();
  await page.getByRole('button',{name:'デスクトップを閉じる',exact:true}).click();
  await page.reload();
  await page.locator('.desktop-tab').first().filter({hasText:'編集した作業'}).waitFor();
  console.log('desktop context: target rename, active desktop, gesture cancellation, keyboard menu, persistence and remote launch passed');
};
