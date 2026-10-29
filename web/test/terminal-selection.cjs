const assert = require('node:assert/strict');
const { join } = require('node:path');

module.exports = async function checkTerminalSelection(page, { terminalTransports, terminalInputs, phase, out }) {
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  const attach = page.locator('.mobile-input .input-attach');
  const draft = page.getByRole('textbox', { name: '文字入力・貼り付け用の下書き' });
  const insert = page.getByRole('button', { name: '端末に挿入', exact: true });
  const tab = number => page.locator(`[data-tab-id="tab-local-${number}"][role=tab]`);
  const waitFor = async (predicate, attempts = 150) => {
    for (let i = 0; i < attempts; i++) { if (predicate()) return; await page.waitForTimeout(20); }
    assert.fail('selection acknowledgement fixture did not receive its expected request');
  };
  const confirm = async request => {
    terminalTransports.at(-1).socket.send(JSON.stringify({ type: 'selectedWindow', requestId: request.requestId, windowId: request.windowId }));
    await page.waitForTimeout(50);
  };
  await waitFor(() => terminalTransports[0]?.selections.length > 0);
  check(await attach.isDisabled(), 'a ready transport still waits for the initial selection acknowledgement');
  await confirm(terminalTransports[0].selections[0]);
  await page.locator('.mobile-input .input-attach:enabled').waitFor();
  await page.getByRole('button', { name: '文字入力・貼り付け', exact: true }).click();
  const text = '切り替え完了後に挿入';
  await draft.fill(text);
  const count = terminalInputs.length;
  await tab(2).click();
  await waitFor(() => terminalTransports[0].selections.at(-1)?.windowId === '@2');
  const olderSameWindow = terminalTransports[0].selections.at(-1);
  await page.waitForFunction(() => document.querySelector('.mobile-input .input-attach').disabled, undefined, { timeout: 1500 }).catch(() => {});
  if (phase === 'after') {
    await page.locator('.panel-connection.selecting').waitFor();
    assert.match(await page.locator('.panel-connection strong').innerText(), /切り替え中/);
    assert.equal(await page.locator('.panel-connection').getByRole('button', { name: '再接続', exact: true }).count(), 0);
  }
  await page.screenshot({ path: join(out, 'terminal-selection-waiting.png'), animations: 'disabled' });
  if (phase === 'before') return;
  check(await attach.isDisabled(), 'attachments wait for the current selection to finish');
  check(await insert.isDisabled(), 'draft insertion waits for the current selection to finish');
  if (!await insert.isDisabled()) await insert.click();
  check(await draft.inputValue() === text, 'an unfinished selection cannot clear the draft');
  check(terminalInputs.length === count, 'the draft is not sent before acknowledgement');
  if (await draft.inputValue() !== text) await draft.fill(text);
  await tab(1).click(); await waitFor(() => terminalTransports[0].selections.at(-1)?.windowId === '@1');
  const olderOtherWindow = terminalTransports[0].selections.at(-1);
  await tab(2).click(); await waitFor(() => terminalTransports[0].selections.at(-1)?.windowId === '@2');
  const latest = terminalTransports[0].selections.at(-1);
  await confirm(olderSameWindow);
  check(await insert.isDisabled(), 'an older acknowledgement for the same window does not unlock the current request');
  await confirm(olderOtherWindow);
  check(await insert.isDisabled(), 'another window acknowledgement cannot unlock input');
  await confirm(latest);
  await insert.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('.mobile-input .input-attach').disabled);
  await insert.click();
  assert.equal(await draft.inputValue(), '');
  assert.equal(terminalInputs.at(-1), text);
  await page.getByRole('button', { name: '入力欄を閉じる', exact: true }).click();
  // Keep browser and application timers on the same real clock.
  await tab(1).click(); await waitFor(() => terminalTransports[0].selections.at(-1)?.windowId === '@1');
  await waitFor(() => terminalTransports.length > 1, 750);
  check(terminalTransports.length > 1, 'a missing acknowledgement times out and reconnects');
  if (terminalTransports.length > 1) {
    await waitFor(() => terminalTransports.at(-1).selections.length > 0);
    check(await attach.isDisabled(), 'the replacement connection requires a fresh acknowledgement');
    await confirm(terminalTransports.at(-1).selections.at(-1));
    await page.locator('.mobile-input .input-attach:enabled').waitFor();
  }
  assert.deepEqual(failures, []);
  console.log('selection acknowledgement: initial readiness, draft retention, stale replies and timeout recovery passed');
};
