const assert = require('node:assert/strict');

// Runs against visual-feedback.cjs's isolated App fixture; no real files are uploaded.
module.exports = async function checkAttachments(page, terminalInputs) {
  const picker = page.locator('.mobile-input input[type=file]');
  const draft = page.getByRole('textbox', { name: '文字入力・貼り付け用の下書き' });
  const insert = page.getByRole('button', { name: '端末に挿入', exact: true });
  const file = name => ({ name, mimeType: 'text/plain', buffer: Buffer.from('fixture') });
  let response;
  await page.route(/\/api\/paste-file\?/, route => response(route));
  const attach = async (files, handler) => {
    response = handler;
    await picker.setInputFiles(files);
  };
  const waitFinished = () => page.getByRole('button', { name: '添付', exact: true }).waitFor();

  const special = "/tmp/it's $(printf surprise); file.txt";
  await attach(file("it's $(printf surprise); file.txt"), route => route.fulfill({ json: { path: special } }));
  await waitFinished();
  assert.equal(terminalInputs.at(-1), "'/tmp/it'\"'\"'s $(printf surprise); file.txt' ");

  await page.getByRole('button', { name: '文字入力・貼り付け', exact: true }).click();
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
  await page.getByRole('status').filter({ hasText: '添付パスを下書きに残しました' }).waitFor();
  assert.equal(terminalInputs.length, count, 'switching tabs during upload never inserts into the new target');
  assert.equal(await draft.inputValue(), '既存の下書き /tmp/delayed.txt ');
  await page.locator('.tile:visible [data-tab-id=tab-local-1]').click();
  await draft.fill('別の下書き');

  let uploads = 0;
  await attach([file('first.txt'), file('second.txt')], route => ++uploads === 1
    ? route.fulfill({ json: { path: '/tmp/first.txt' } })
    : route.fulfill({ status: 500, json: { error: '2件目の送信に失敗しました' } }));
  await waitFinished();
  await page.getByRole('status').filter({ hasText: '1件を保存済み' }).waitFor();
  assert.equal(await draft.inputValue(), '別の下書き /tmp/first.txt ');
  assert.equal(terminalInputs.length, count, 'partial uploads preserve their paths without sending incomplete input');
  await insert.click();
  assert.equal(terminalInputs.at(-1), '別の下書き /tmp/first.txt ');
  assert.equal(await draft.inputValue(), '');
  await page.getByRole('button', { name: '入力欄を閉じる', exact: true }).click();
  console.log('attachment quoting, upload target and partial-failure recovery passed');
};
