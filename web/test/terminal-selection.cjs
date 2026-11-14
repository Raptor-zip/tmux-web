const assert = require('node:assert/strict');
const { join } = require('node:path');

module.exports = async function checkTerminalSelection(page, { terminalTransports, terminalInputs, phase, out }) {
  const attach = page.locator('.mobile-input .input-attach');
  const draft = page.getByRole('textbox', { name: '文字入力・貼り付け用の下書き' });
  const insert = page.getByRole('button', { name: '端末に挿入', exact: true });
  const tab = number => page.locator(`[data-tab-id="tab-local-${number}"][role=tab]`);
  const waitFor = async (predicate, attempts = 150) => {
    for (let i = 0; i < attempts; i++) { if (predicate()) return; await page.waitForTimeout(20); }
    assert.fail('selection acknowledgement fixture did not receive its expected request');
  };
  const confirm = async (transport, request) => {
    transport.socket.send(JSON.stringify({ type: 'selectedWindow', requestId: request.requestId, windowId: request.windowId }));
    await page.waitForTimeout(50);
  };
  await waitFor(() => terminalTransports[0]?.selections.length > 0);
  assert.equal(await attach.isDisabled(), true, 'initial selection waits for acknowledgement');
  const first = terminalTransports[0];
  await confirm(first, first.selections[0]);
  await page.locator('.mobile-input .input-attach:enabled').waitFor();
  await page.getByRole('button', { name: '文字入力・貼り付け', exact: true }).click();
  const text = '切り替え完了後に挿入';
  await draft.fill(text);
  const count = terminalInputs.length;
  await tab(2).click();
  await waitFor(() => terminalTransports[1]?.selections.at(-1)?.windowId === '@2');
  const second = terminalTransports[1];
  const request = second.selections.at(-1);
  await page.locator('.panel-connection.selecting').waitFor();
  assert.match(await page.locator('.panel-connection strong').innerText(), /切り替え中/);
  assert.equal(await page.locator('.panel-connection').getByRole('button', { name: '再接続', exact: true }).count(), 0);
  await page.screenshot({ path: join(out, 'terminal-selection-waiting.png'), animations: 'disabled' });
  if (phase === 'before') return;
  assert.equal(await attach.isDisabled(), true, 'attachments wait for the current selection to finish');
  assert.equal(await insert.isDisabled(), true, 'draft insertion waits for the current selection to finish');
  assert.equal(await draft.inputValue(), text, 'an unfinished selection preserves the draft');
  assert.equal(terminalInputs.length, count, 'draft is not sent before acknowledgement');
  await tab(1).click();
  assert.equal(await attach.isDisabled(), false, 'returning to an acknowledged tab is ready immediately');
  assert.equal(terminalTransports.length, 2, 'returning keeps both transports');
  await tab(2).click();
  assert.equal(await insert.isDisabled(), true, 'a different ready tab does not unlock this tab');
  await confirm(second, { ...request, windowId: '@1' });
  assert.equal(await insert.isDisabled(), true, 'another window acknowledgement cannot unlock input');
  await confirm(second, { ...request, requestId: request.requestId - 1 });
  assert.equal(await insert.isDisabled(), true, 'a stale request acknowledgement cannot unlock input');
  await confirm(second, request);
  await page.waitForFunction(() => !document.querySelector('.mobile-input .input-attach').disabled);
  await insert.click();
  assert.equal(await draft.inputValue(), '');
  assert.equal(terminalInputs.at(-1), text);
  await page.getByRole('button', { name: '入力欄を閉じる', exact: true }).click();
  // A lost connection still needs a fresh acknowledgement and retries on timeout.
  first.socket.close();
  await tab(1).click();
  await waitFor(() => terminalTransports.length === 3);
  assert.equal(await attach.isDisabled(), true, 'replacement connection waits for a fresh acknowledgement');
  await waitFor(() => terminalTransports.length === 4, 750);
  await waitFor(() => terminalTransports.at(-1).selections.length > 0);
  const replacement = terminalTransports.at(-1);
  await confirm(replacement, replacement.selections.at(-1));
  await page.locator('.mobile-input .input-attach:enabled').waitFor();
  console.log('selection acknowledgement: cached readiness, draft retention, stale replies and timeout recovery passed');
};
