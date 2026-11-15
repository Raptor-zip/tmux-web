const assert = require('node:assert/strict');

// TERMINAL_RENDERER=webgl で、描画方式の切り替えとコンテキスト喪失からの復帰を確かめる。
// 表示中の端末だけが WebGL を持ち、隠したタブ・裏に回ったページでは手放すこと、
// GPU のコンテキストを失ったら DOM 描画に戻って入力も届くことを見る。
module.exports = async function checkTerminalWebgl(page, { terminalTransports, terminalInputs }) {
  const webglCanvases = () => page.evaluate(() => [...document.querySelectorAll('.terminal-host .xterm-screen canvas')]
    .filter(canvas => canvas.closest('.terminal-host:not([hidden])')).length);
  const hiddenCanvases = () => page.evaluate(() => document.querySelectorAll('.terminal-host[hidden] .xterm-screen canvas').length);
  await page.waitForFunction(() => document.querySelector('.terminal-host:not([hidden]) .xterm-screen canvas'));
  assert.ok(await webglCanvases() > 0, 'the visible terminal renders with WebGL');
  assert.equal(await page.locator('.terminal-host:not([hidden]) .xterm-rows').count(), 0, 'the DOM renderer is replaced while WebGL is active');

  // 端末から tmux へ送られるリサイズを数える（描画方式の切り替えで列数が変わらないこと）
  await page.evaluate(() => {
    window.__resizes = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try { const message = JSON.parse(data); if (message.type === 'resize') window.__resizes.push(message); } catch {}
      return send.call(this, data);
    };
    // 表示中の WebGL コンテキストを覚えておき、手放したときに本当に解放されたかを見る
    window.__contexts = [...document.querySelectorAll('.terminal-host:not([hidden]) .xterm-screen canvas:not(.xterm-link-layer)')]
      .map(canvas => canvas.getContext('webgl2')).filter(Boolean);
  });

  // 別のタブを開くと、隠れた端末は WebGL を手放す
  const tabs = page.locator('.tab[role="tab"]');
  if (await tabs.count() > 1) {
    await tabs.nth(1).click();
    await page.waitForTimeout(150);
    assert.equal(await hiddenCanvases(), 0, 'hidden terminals release their WebGL context');
    assert.ok(await page.evaluate(() => window.__contexts.some(gl => !gl.canvas.isConnected) && window.__contexts.every(gl => gl.canvas.isConnected || gl.isContextLost())),
      'the GPU context of a hidden terminal is released, not left for garbage collection');
    assert.ok(await webglCanvases() > 0, 'the newly shown terminal renders with WebGL');
    await tabs.nth(0).click();
    await page.waitForTimeout(150);
    assert.equal(await hiddenCanvases(), 0);
  }

  // ページが裏に回ったら手放し、戻ったら作り直す（スリープ復帰の喪失を持ち越さない）
  const previous = terminalTransports.length;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.xterm-screen canvas').count(), 0, 'a background page holds no WebGL contexts');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => document.querySelector('.terminal-host:not([hidden]) .xterm-screen canvas'));
  assert.equal(terminalTransports.length, previous, 'switching renderers does not reconnect');
  await page.waitForTimeout(250);
  const resizeCount = await page.evaluate(() => window.__resizes.length);
  assert.equal(resizeCount, 0, `switching renderers does not resize tmux (${JSON.stringify(await page.evaluate(() => window.__resizes))})`);

  // GPU のコンテキストを失わせる。xterm は復旧を 3 秒待ってから諦めるので、それより長く待つ
  const lost = await page.evaluate(() => {
    let count = 0;
    for (const canvas of document.querySelectorAll('.terminal-host:not([hidden]) .xterm-screen canvas')) {
      const gl = canvas.getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_lose_context');
      if (ext) { ext.loseContext(); count++; }
    }
    return count;
  });
  assert.ok(lost > 0, 'a WebGL context was available to lose');
  await page.waitForFunction(() => document.querySelector('.terminal-host:not([hidden]) .xterm-rows'), null, { timeout: 8000 });
  assert.equal(await webglCanvases(), 0, 'a lost context falls back to the DOM renderer');

  const marker = 'after-context-loss';
  for (const transport of terminalTransports) if (!transport.closed) transport.socket.send(Buffer.from(`\x1b[2J\x1b[H${marker}\r\n日本語の描画確認`));
  await page.waitForFunction(marker => document.querySelector('.terminal-host:not([hidden]) .xterm-rows')?.textContent.includes(marker), marker);
  await page.locator('.terminal-host:not([hidden]) .xterm-helper-textarea').first().focus();
  await page.keyboard.type('webgl-fallback-input');
  await page.waitForTimeout(50);
  assert.ok(terminalInputs.join('').includes('webgl-fallback-input'), 'input still reaches tmux after the fallback');
  console.log('terminal webgl: visible-only contexts, background release, context-loss fallback and input passed');
};
