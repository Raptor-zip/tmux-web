const assert = require('node:assert/strict');
const { join } = require('node:path');
module.exports = async function checkDesktopContext(page, { scene, out, screenshots }) {
  assert.equal(await page.locator('.desktop-rename').count(), 0);
  const phone = require('./phone.cjs');
  if (await phone.isPhoneHead(page)) {
    // スマホの見出し 1 行：ワークスペースはタブ一覧シートの列にある。右クリック・長押しで同じメニュー
    await page.locator('.desktop-bar .phone-tab').click();
    const sheet = page.getByRole('dialog', { name: 'タブ一覧', exact: true });
    const ws = sheet.getByRole('group', { name: 'ワークスペース', exact: true });
    assert.equal(await ws.locator('.tsheet-ws[aria-current=true]').textContent(), '1ワークスペース 1');
    await ws.locator('.tsheet-ws[aria-current=true]').click({ button: 'right' });
    await sheet.waitFor({ state: 'detached' });
    await page.getByRole('menuitem', { name: '名前を変更…', exact: true }).waitFor();
    assert.equal(await page.getByRole('menu').getAttribute('aria-label'), 'ワークスペース 1', 'the sheet opens the workspace menu');
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'detached' });
    // 以下はワークスペースタブを並べた表示（『スマホでタブ列を表示』）で確かめる
    await phone.showPhoneTabs(page);
  }
  // ワークスペースバー：タブごとの × とモニタアイコンは無い。追加は ⊞『新しいワークスペース』
  const bar = page.locator('.desktop-bar');
  assert.equal(await bar.getByRole('button', { name:'リモートデスクトップ', exact:true }).count(), 0, 'no monitor icon in the workspace bar');
  assert.equal(await page.getByRole('tablist',{name:'ワークスペース',exact:true}).count(), 1);
  await bar.getByRole('button',{name:'新しいワークスペース',exact:true}).click();
  assert.equal(await page.locator('.desktop-close').count(), 0, 'workspace tabs have no close button');
  assert.equal(await page.locator('.desktop-tab').nth(1).textContent(), '2ワークスペース 2', 'new workspaces get the default name ワークスペース N');
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
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('role')),'menuitem','the menu focuses its first item, not the close button');
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'名前を変更…');
  assert.equal(await page.getByRole('menu').getAttribute('aria-label'),'ワークスペース 1','the menu is titled with its target');
  assert.deepEqual(await page.getByRole('menu').getByRole('menuitem').evaluateAll(items=>items.map(el=>[el.getAttribute('aria-label')||el.querySelector('.ctx-label')?.textContent||el.textContent,el.disabled])).then(rows=>rows.map(([name,disabled])=>[name.replace(/Alt\+Shift\+N$/,'').trim(),disabled])),
    [['名前を変更…',false],['新しいワークスペース',false],['左へ移す',true],['右へ移す',false],['ワークスペースを削除…',false]], 'the workspace menu lists rename, new, move and delete');
  if (scene.touch) {
    // タッチのシートでは、右上の × で閉じる（先頭の『閉じる』項目は無い）
    assert.equal(await page.getByRole('menuitem',{name:'閉じる',exact:true}).count(),0);
    await page.getByRole('button',{name:'メニューを閉じる',exact:true}).click();
    assert.equal(await page.getByRole('menu').count(),0,'the sheet × closes the menu');
    await first.click({button:'right'});
    await edit.waitFor();
  }
  if (screenshots) await page.screenshot({path:join(out,scene.name+'-menu.png'),animations:'disabled'});
  await edit.click();
  assert.equal(await page.locator('.dialog-input').inputValue(),'ワークスペース 1');
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
  // 右へ移す：並びが入れ替わり、表示中のワークスペースは変わらない
  const openMenu = async tab => { await tab.focus(); await page.keyboard.press('Shift+F10'); await page.getByRole('menu').waitFor(); };
  await openMenu(first);
  await page.getByRole('menuitem',{name:'右へ移す',exact:true}).click();
  await page.waitForFunction(id => JSON.parse(localStorage.getItem('tw.desktops')).items[1].id === 'main' && JSON.parse(localStorage.getItem('tw.desktops')).activeId === id, activeId);
  assert.match(await page.locator('.desktop-tab').nth(1).textContent(), /^2編集した作業$/);
  // 削除…は確認付き。最初のフォーカスはキャンセルで、Enter だけでは消えない
  const moved = page.locator('.desktop-tab').nth(1);
  await openMenu(moved);
  await page.getByRole('menuitem',{name:'ワークスペースを削除…',exact:true}).click();
  const confirm = page.getByRole('dialog',{name:'ワークスペース「編集した作業」を削除しますか？',exact:true});
  await confirm.waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'キャンセル','delete confirmation focuses Cancel first');
  await page.keyboard.press('Enter');
  await confirm.waitFor({state:'detached'});
  assert.equal(await page.locator('.desktop-tab').count(), 2, 'Enter on Cancel keeps the workspace');
  await openMenu(moved);
  await page.getByRole('menuitem',{name:'左へ移す',exact:true}).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('tw.desktops')).items[0].id === 'main');
  await page.reload();
  await page.locator('.desktop-tab').first().filter({hasText:'編集した作業'}).waitFor();
  const kept = page.locator('.desktop-tab').nth(1);
  await openMenu(kept);
  await page.getByRole('menuitem',{name:'ワークスペースを削除…',exact:true}).click();
  await page.getByRole('dialog',{name:'ワークスペース「ワークスペース 2」を削除しますか？',exact:true}).getByRole('button',{name:'削除する',exact:true}).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('tw.desktops')).items.length === 1);
  await openMenu(page.locator('.desktop-tab').first());
  assert.equal(await page.getByRole('menuitem',{name:'ワークスペースを削除…',exact:true}).isDisabled(), true, 'the last workspace cannot be deleted');
  await page.keyboard.press('Escape');
  console.log('desktop context: workspace menu (rename, new, move, delete with confirmation), active workspace, gesture cancellation, keyboard menu and persistence passed');
};
