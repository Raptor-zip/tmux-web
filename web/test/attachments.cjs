const assert = require('node:assert/strict');

// Runs against visual-feedback.cjs's isolated App fixture; no real files are uploaded.
module.exports = async function checkAttachments(page, terminalInputs, transports) {
  const picker = page.locator('.input-bar input[type=file]');
  const draft = page.getByRole('textbox', { name: '下書き', exact: true });
  const insert = page.getByRole('button', { name: '挿入のみ', exact: true });
  const file = name => ({ name, mimeType: 'text/plain', buffer: Buffer.from('fixture') });
  let response;
  await page.route(/\/api\/paste-file\?/, route => response(route));
  const attach = async (files, handler) => {
    response = handler;
    await picker.setInputFiles(files);
  };
  const waitFinished = () => page.getByRole('button', { name: '添付', exact: true }).waitFor();

  const toggle = page.locator('.input-bar').getByRole('button', { name: '入力', exact: true });
  await toggle.click();
  const special = "/tmp/it's $(printf surprise); file.txt";
  await attach(file("it's $(printf surprise); file.txt"), route => route.fulfill({ json: { path: special } }));
  await waitFinished();
  assert.equal(terminalInputs.at(-1), "'/tmp/it'\"'\"'s $(printf surprise); file.txt' ");

  await draft.fill('既存の下書き');
  let release, requested;
  const requestStarted = new Promise(resolve => { requested = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const count = terminalInputs.length;
  await attach(file('delayed.txt'), async route => {
    requested();
    await held;
    await route.fulfill({ json: { path: '/tmp/delayed.txt' } });
  });
  await requestStarted;
  await page.locator('.tile:visible [data-tab-id=tab-local-5]').click();
  release();
  await waitFinished();
  // Each tab keeps its own connection, so the finished upload lands in the tab it started from.
  const transportOf = window => transports.find(t => t.window === window && !t.remote && !t.closed);
  assert.equal(terminalInputs.length, count + 1);
  assert.equal(transportOf('@1').inputs.at(-1), '/tmp/delayed.txt ', 'the upload is inserted into the tab it was started from');
  assert.equal(transportOf('@5').inputs.length, 0, 'switching tabs during upload never inserts into the new target');
  assert.equal(await draft.inputValue(), '既存の下書き', 'the draft is left alone');
  await page.locator('.tile:visible [data-tab-id=tab-local-1]').click();
  await draft.fill('別の下書き');

  let uploads = 0;
  await attach([file('first.txt'), file('second.txt')], route => ++uploads === 1
    ? route.fulfill({ json: { path: '/tmp/first.txt' } })
    : route.fulfill({ status: 500, json: { error: '2件目の送信に失敗しました' } }));
  await waitFinished();
  await page.getByRole('status').filter({ hasText: '1件を保存済み' }).waitFor();
  assert.equal(await draft.inputValue(), '別の下書き /tmp/first.txt ');
  assert.equal(terminalInputs.length, count + 1, 'partial uploads preserve their paths without sending incomplete input');
  await insert.click();
  assert.equal(terminalInputs.at(-1), '別の下書き /tmp/first.txt ');
  assert.equal(await draft.inputValue(), '');

  // 送信 ↵ pastes the draft and then sends Enter in one tap
  await draft.fill('送信する下書き');
  await page.getByRole('button', { name: '送信 ↵', exact: true }).click();
  assert.deepEqual(terminalInputs.slice(-2), ['送信する下書き', '\r'], '送信 pastes and then presses Enter');
  assert.equal(await draft.inputValue(), '');
  await toggle.click();
  assert.equal(await draft.count(), 0, '入力 closes the draft');

  // The key row keeps a fixed order; ⇧Tab sends back-tab; Enter has a single home at the right end
  const keys = await page.locator('.input-bar .input-keys button').allInnerTexts();
  assert.deepEqual(keys, ['Esc', '↑', '↓', 'Tab', '^C', '⇧Tab', '←', '→', '1', '2', '3', 'y', 'n', 'キー⋯']);
  await page.locator('.input-bar').getByRole('button', { name: 'Shift+Tab', exact: true }).click();
  assert.equal(terminalInputs.at(-1), '\x1b[Z');
  await page.locator('.input-bar').getByRole('button', { name: 'Enter', exact: true }).click();
  assert.equal(terminalInputs.at(-1), '\r');
  assert.equal(await page.getByRole('button', { name: /^Enter/ }).count(), 1, 'one Enter button');
  const row = await page.locator('.input-bar .input-row').boundingBox();
  const enter = await page.locator('.input-bar .input-enter').boundingBox();
  assert.ok(Math.abs(row.x + row.width - (enter.x + enter.width)) <= 1, '↵ is pinned to the right end');
  assert.ok(row.height <= 45, `input row is one line (${row.height}px)`);
  // キー⋯ opens the rarer keys
  await page.locator('.input-bar').getByRole('button', { name: 'キー⋯', exact: true }).click();
  await page.getByRole('menuitem', { name: /^\^L/ }).click();
  assert.equal(terminalInputs.at(-1), '\x0c');
  await page.locator('.input-bar').getByRole('button', { name: 'キー⋯', exact: true }).click();
  await page.getByRole('menuitem', { name: /^tmux prefix/ }).click();
  assert.equal(terminalInputs.at(-1), '\x02');
  console.log('attachment quoting, upload target, partial-failure recovery and the input row passed');
};
