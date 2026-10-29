---
date: 2026-10-29 23:33:46
phase: "調査"
iteration: 1
status: partial
---

## やろうとしたこと

2026-10-30 04:00 JSTまで改善を継続する。初回は `npm test -w server`、`npm test -w web`、`npx tsc --noEmit -p web/tsconfig.json`、`npm run build` とコードの調査を実行した。

## 実際に起きたこと

Webの19テスト、型検査、production buildが通過。サーバは43件中42件成功、1件が失敗した。

```text
✖ terminal scrolling installs and updates live tmux (XDG config) (5687.016468ms)
  AssertionError [ERR_ASSERTION]: terminal did not reach the expected state
      at waitFor (file:///home/somak/tmux-web/server/test/terminal.test.js:15:10)
      at async TestContext.<anonymous> (file:///home/somak/tmux-web/server/test/terminal.test.js:155:9)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: undefined,
    operator: 'fail',
    diff: 'simple'
  }
npm error Lifecycle script `test` failed with error:
npm error code 1
npm error path /home/somak/tmux-web/server
npm error workspace @tmux-web/server@0.1.0
npm error location /home/somak/tmux-web/server
npm error command failed
npm error command sh -c node --test test/*.test.js
```

単独の `node --test server/test/terminal.test.js` では3件とも成功した。

## 原因

スクロールテストの失敗原因は不明。仮説: 直前のCodex用fixtureと同じready文字列をClaude側でも待つため、古い出力を検出して早く入力する競合。添付機能では中継経路の不足、シェル引数の引用不足、非同期処理後の入力先の再確認不足をコード上で確認した。

## 試して却下した方法

なし。待ち時間を増やす変更は根拠がないため行っていない。

## 最終的な対応

添付機能を最初の改善単位にする。スクロール失敗は単独で再現しなかったことを記録し、次の全体検証でも確認する。

## 次にやる人が知っておくべきこと

開始時のブランチはmain、HEADはb163182、作業ツリーはクリーン。originはRaptor-zip/tmux-web。実行中のユーザーのtmuxやサービス設定はテスト対象にせず、分離fixtureを使う。
