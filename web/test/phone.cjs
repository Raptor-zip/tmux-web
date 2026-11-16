// スマホの見出し 1 行（≡ / 現在のタブ ▾ n/m / 要対応 / ＋▾ / ⋯）を通る操作の共通部品。
// 幅 ≤760px（またはタッチで高さ ≤480px）では、タイル見出しのタブ列・ワークスペースタブ・接続状態の点・⌕ が
// 見出しに無い。デスクトップでは今までどおりの場所を使う。

/** スマホの見出しを使っているか */
const isPhoneHead = async page => (await page.locator('.desktop-bar .phone-tab:visible').count()) > 0;

/**
 * 入力先のタイルの見出し。スマホでは上の見出し（＋▾ と ⋯ はそこにある）。
 * どちらも同じ名前のボタン（新規メニュー・タブの操作・新しい端末）を持つ。
 */
const focusedHead = page => page.locator('.tile.focused .tabstrip:visible, .desktop-bar:has(.phone-tab)');

/** ⌕ 探す・操作。スマホ縦ではタブ一覧シートの『すべての端末を探す』から */
async function openPalette(page) {
  const direct = page.locator('.desktop-bar .bar-palette:visible');
  if (await direct.count()) return direct.click();
  await page.locator('.desktop-bar .phone-tab').click();
  await page.getByRole('dialog', { name: 'タブ一覧', exact: true }).getByRole('button', { name: 'すべての端末を探す', exact: true }).click();
}

/** 接続状態のポップオーバー。スマホでは正常なときの点が見出しに無いので、⋯ のシートの先頭から */
async function openConnection(page) {
  const chip = page.locator('.desktop-bar .conn-status:visible');
  if (await chip.count()) await chip.click();
  else {
    await page.locator('.desktop-bar').getByRole('button', { name: 'タブの操作', exact: true }).click();
    await page.getByRole('menuitem', { name: /^接続状態：/ }).click();
  }
  await page.getByRole('dialog', { name: '接続状態', exact: true }).waitFor();
}

/** 『表示と接続』の『スマホでタブ列を表示』をオンにする（タブ列とワークスペースタブを見出しの下に出す） */
async function showPhoneTabs(page) {
  if (!await isPhoneHead(page)) return;
  await openConnection(page);
  await page.getByRole('button', { name: '表示と接続…', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '表示と接続', exact: true });
  await settings.waitFor();
  const toggle = settings.getByRole('switch', { name: /スマホでタブ列を表示/ });
  if (await toggle.getAttribute('aria-checked') !== 'true') await toggle.click();
  await page.keyboard.press('Escape');
  await settings.waitFor({ state: 'detached' });
  await page.locator('.tile.focused .tabstrip:visible').waitFor();
}

/** タブを前面に出す。スマホでは見出しの『現在のタブ ▾』→ タブ一覧シートの行から */
async function pickTab(page, tabId) {
  if (!await isPhoneHead(page)) return page.locator(`.tile:visible [data-tab-id="${tabId}"][role=tab]`).click();
  await page.locator('.desktop-bar .phone-tab').click();
  const sheet = page.getByRole('dialog', { name: 'タブ一覧', exact: true });
  await sheet.locator(`[data-sheet-tab="${tabId}"]`).click();
  await sheet.waitFor({ state: 'detached' });
}

module.exports = { isPhoneHead, focusedHead, openPalette, openConnection, showPhoneTabs, pickTab };
