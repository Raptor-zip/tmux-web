const assert = require('node:assert/strict');
const { join } = require('node:path');

// Synthetic uploads, media tickets and archives. Never touches real project files.
module.exports = async function prepareFiles(page, { scene, phase, out }) {
  const initialRoot = '/home/demo/projects/atlas-web';
  let root = initialRoot, ticket = 0, failedImage = false, removeImage = false;
  let holdUpload = false, releaseUpload, holdArchive = false, releaseArchive;
  const ticketPaths = new Map();
  const saved = [], uploads = [];
  const entry = (name, directory = false, prefix = '') => ({ name, path: prefix + name, directory, size: directory || name === 'empty.txt' ? 0 : name === 'large.txt' ? 300000 : 120, modified: 1792597800000, mime: directory ? '' : name.endsWith('.png') ? 'image/png' : 'text/plain' });
  await page.route(/\/api\/files(?:\/(?:open|upload|archive))?(?:\?|$)/, async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/open')) { const id = `preview-${++ticket}`; ticketPaths.set(id, route.request().postDataJSON().path); return route.fulfill({ json: { url: `/files/content?ticket=${id}` } }); }
    if (url.pathname.endsWith('/upload')) {
      const name = url.searchParams.get('name'), directory = url.searchParams.get('path');
      uploads.push({ name, directory });
      if (name === 'partial-fail.txt') return route.fulfill({ status: 500, json: { error: '送信に失敗しました' } });
      saved.push({ name, directory });
      if (holdUpload) await new Promise(resolve => { releaseUpload = resolve; });
      return route.fulfill({ json: { name } }).catch(() => {});
    }
    if (url.pathname.endsWith('/archive')) {
      if (holdArchive) await new Promise(resolve => { releaseArchive = resolve; });
      return route.fulfill({ json: { url: '/files/content?ticket=archive' } }).catch(() => {});
    }
    const directory = url.searchParams.get('path') || '';
    const items = directory === '' ? [entry('assets', true), ...(!removeImage ? [entry('preview.png')] : []), entry('notes.txt'), entry('large.txt'), entry('empty.txt'), ...saved.filter(item => item.directory === '').map(item => entry(item.name))]
      : directory === 'assets' ? [entry('nested', true, 'assets/')]
      : [entry('existing.txt', false, directory + '/'), ...saved.filter(item => item.directory === directory).map(item => entry(item.name, false, directory + '/'))];
    return route.fulfill({ json: { root, path: directory, items } });
  });
  await page.route(/\/files\/content\?/, route => {
    const path = ticketPaths.get(new URL(route.request().url()).searchParams.get('ticket'));
    if (route.request().url().includes('ticket=archive')) return route.fulfill({ contentType: 'application/gzip', headers: { 'Content-Disposition': 'attachment; filename="fixture.tar.gz"' }, body: 'fixture' });
    if (route.request().resourceType() === 'image') {
      if (!failedImage) { failedImage = true; return route.fulfill({ status: 503, body: 'offline fixture' }); }
      return route.fulfill({ contentType: 'image/svg+xml', headers: { 'Cache-Control': 'no-store' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200"><rect width="360" height="200" fill="#283457"/><text x="24" y="108" fill="#c0caf5" font-size="24">Preview recovered</text></svg>' });
    }
    if (path === 'empty.txt') return route.fulfill({ status: 416, headers: { 'Content-Range': 'bytes */0' }, body: '' });
    if (path === 'large.txt') { assert.equal(route.request().headers().range, 'bytes=0-262143'); return route.fulfill({ status: 206, contentType: 'text/plain', headers: { 'Content-Range': 'bytes 0-262143/300000' }, body: 'x'.repeat(256 * 1024) }); }
    return route.fulfill({ contentType: 'text/plain', headers: { 'Cache-Control': 'no-store' }, body: 'Synthetic project notes\nNo private data.' });
  });
  const openBrowser = async () => {
    await page.locator('.tile.focused').getByRole('button', { name: 'パネルの操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '作業フォルダーのファイルを見る', exact: true }).click();
    await page.locator('.file-row').first().waitFor();
  };
  const dialog = page.getByRole('dialog', { name: 'ファイル一覧とプレビュー' });
  const row = name => dialog.locator('.file-row').filter({ has: page.locator('.file-name', { hasText: name }) });
  const file = name => ({ name, mimeType: 'text/plain', buffer: Buffer.from('fixture upload') });
  const waitUpload = async () => {
    const deadline = Date.now() + 5000;
    while (!releaseUpload && Date.now() < deadline) await page.waitForTimeout(20);
    assert.equal(typeof releaseUpload, 'function');
  };
  return async () => {
    await row('assets').click(); await row('nested').click();
    holdUpload = true;
    await dialog.locator('input[type=file]').setInputFiles([file('upload-first.txt'), file('upload-second.txt')]);
    await waitUpload();
    await dialog.getByRole('status').filter({ hasText: 'upload-first.txt' }).waitFor();
    await page.screenshot({ path: join(out, `${scene.name}-upload.png`), animations: 'disabled' });
    if (phase === 'after') {
      for (const breadcrumb of await dialog.locator('.file-breadcrumbs button').all()) assert.equal(await breadcrumb.isDisabled(), true, 'every breadcrumb is locked during upload');
      assert.equal(await dialog.getByRole('button', { name: '更新', exact: true }).isDisabled(), true);
      await dialog.getByRole('button', { name: '送信を中止', exact: true }).click();
      await dialog.getByRole('status').filter({ hasText: '送信を中止しました' }).waitFor();
      holdUpload = false; releaseUpload();
      assert.equal(uploads.length, 1, 'cancel never starts the next file');
      await row('upload-first.txt').waitFor();
      await dialog.locator('input[type=file]').setInputFiles([file('partial-ok.txt'), file('partial-fail.txt')]);
      await dialog.getByRole('status').filter({ hasText: '1件を保存済み' }).waitFor();
      await row('partial-ok.txt').waitFor();
      assert.ok(uploads.every(item => item.directory === 'assets/nested'), 'all uploads retain the selected destination');
      await dialog.getByRole('textbox', { name: 'ファイル名で絞り込む' }).fill('no-matching-file');
      await dialog.getByText('条件に一致するファイルがありません。', { exact: true }).waitFor();
    } else { holdUpload = false; releaseUpload(); await dialog.getByRole('status').filter({ hasText: '2件のファイルをアップロードしました' }).waitFor(); }
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
    await openBrowser();
    await row('preview.png').click();
    await dialog.getByRole('alert').waitFor();
    await page.screenshot({ path: join(out, `${scene.name}-preview-error.png`), animations: 'disabled' });
    if (phase === 'after') {
      const previous = ticket;
      await dialog.getByRole('button', { name: 'プレビューを再読み込み', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.file-preview img')?.naturalWidth > 0);
      assert.ok(ticket > previous, 'preview retry issues a new signed URL');
      if (scene.width > 760) {
        const stableTicket = ticket;
        await dialog.locator('input[type=file]').setInputFiles(file('background.txt'));
        await row('background.txt').waitFor();
        await dialog.locator('.file-preview img').waitFor();
        assert.equal(ticket, stableTicket, 'background list updates preserve an unchanged preview');
        saved.splice(saved.findIndex(item => item.name === 'background.txt'), 1);
        removeImage = true;
        await dialog.getByRole('button', { name: '更新', exact: true }).click();
        await dialog.locator('.file-empty').waitFor();
        assert.equal(await dialog.getByRole('link', { name: 'ダウンロード', exact: true }).count(), 0, 'deleted files lose their stale preview link');
        removeImage = false;
        await dialog.getByRole('button', { name: '更新', exact: true }).click();
        await row('preview.png').waitFor();
        await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
        await openBrowser();
      } else await dialog.getByRole('button', { name: '← 一覧', exact: true }).click();
      await row('large.txt').click();
      await dialog.getByText('先頭256KBを表示しています。全体はダウンロードして確認してください。', { exact: true }).waitFor();
      assert.equal((await dialog.locator('.file-text').textContent()).length, 256 * 1024);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'long text scrolls inside its preview');
      if (scene.width <= 760) await dialog.getByRole('button', { name: '← 一覧', exact: true }).click();
      await row('empty.txt').click();
      await dialog.getByText('空のファイルです。', { exact: true }).waitFor();
      if (scene.width <= 760) await dialog.getByRole('button', { name: '← 一覧', exact: true }).click();
      await row('notes.txt').click();
      await dialog.locator('.file-text').waitFor();
      assert.match(await dialog.locator('.file-text').textContent(), /Synthetic project notes/);
      await page.screenshot({ path: join(out, `${scene.name}-text.png`), animations: 'disabled' });
      if (scene.width > 760) {
        root = '/home/demo/projects/other';
        await dialog.getByRole('button', { name: '更新', exact: true }).click();
        await dialog.locator('.file-empty').waitFor();
        assert.equal(await dialog.locator('.file-root').textContent(), root, 'project changes discard the previous project preview');
        root = initialRoot;
        await dialog.getByRole('button', { name: 'ルート', exact: true }).click();
        await row('notes.txt').click(); await dialog.locator('.file-text').waitFor();
      }
      const contained = await page.evaluate(() => { document.querySelector('.tile.focused .xterm-helper-textarea')?.focus(); return !!document.activeElement?.closest('.file-browser'); });
      assert.equal(contained, true, 'native modal refuses background terminal focus');
      await dialog.locator('.file-text').focus();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      await openBrowser();
      let downloads = 0;
      const onDownload = () => { downloads++; };
      page.on('download', onDownload);
      holdArchive = true;
      await dialog.getByRole('button', { name: 'フォルダーを保存', exact: true }).click();
      const deadline = Date.now() + 5000;
      while (!releaseArchive && Date.now() < deadline) await page.waitForTimeout(20);
      assert.equal(typeof releaseArchive, 'function');
      await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
      holdArchive = false; releaseArchive();
      await page.waitForTimeout(150);
      assert.equal(downloads, 0, 'closing cancels archive preparation instead of starting a background download');
      page.off('download', onDownload);
    } else {
      if (scene.width <= 760) await dialog.getByRole('button', { name: '← 一覧', exact: true }).click();
      await row('notes.txt').click(); await dialog.locator('iframe').waitFor();
      await page.frameLocator('.file-preview iframe').locator('body').filter({ hasText: 'Synthetic project notes' }).waitFor();
      await page.screenshot({ path: join(out, `${scene.name}-text.png`), animations: 'disabled' });
      await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
    }
    root = initialRoot;
    await openBrowser();
    console.log(scene.name + ' file navigation, preview and transfer checks passed');
  };
};
