---
date: 2026-10-29 23:41:21
phase: "スクロール検証"
iteration: 3
status: partial
---

## やろうとしたこと

初回から断続的に失敗するserver/test/terminal.test.jsの155行目を反復実行で切り分けた。

## 実際に起きたこと

変更前の10回反復は途中で失敗した。ログは/tmp/tmux-web-terminal-repeat-*.log。エラーは次の通り。

```text
✖ terminal scrolling installs and updates live tmux (home config) (5745.776615ms)
✖ terminal scrolling installs and updates live tmux (XDG config) (5745.16033ms)
✔ terminal setup preserves settings and starts independent, visible tmux sessions (468.660963ms)
ℹ tests 3
ℹ suites 0
ℹ pass 1
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11997.727665

✖ failing tests:

test at server/test/terminal.test.js:19:3
✖ terminal scrolling installs and updates live tmux (home config) (5745.776615ms)
  AssertionError [ERR_ASSERTION]: terminal did not reach the expected state
      at waitFor (file:///home/somak/tmux-web/server/test/terminal.test.js:15:10)
      at async TestContext.<anonymous> (file:///home/somak/tmux-web/server/test/terminal.test.js:155:9)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:358:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: undefined,
    operator: 'fail',
    diff: 'simple'
  }

test at server/test/terminal.test.js:19:3
✖ terminal scrolling installs and updates live tmux (XDG config) (5745.16033ms)
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
```

一時コピーでready文字列をプロセス名別に変更したところ、10回×3テストがすべて通過した。

## 原因

Codexのfixture出力が残っている状態で、Claudeのfixtureも同じnormal-agent-readyを待っていた。pane_current_commandは起動直後に切り替わるため、古い文字列と新しいプロセス名の組み合わせで起動完了と誤判定できる。実際のraw modeと入力リスナーの準備前にホイールとqを送る競合がある。

## 試して却下した方法

| 方法 | 結果 | 却下理由 |
| --- | --- | --- |
| 待ち時間を増やす | 実施せず | 誤ったready判定を修正する必要があり、固定sleepでは保証できない |

## 最終的な対応

実テストでもプロセス名別のready文字列を使う。ユーザー向けのtmux設定やスクロール動作はこの変更では変えない。反復検証とサーバ全体検証を行う。

## 次にやる人が知っておくべきこと

一時コピーserver/test/.terminal-readiness.test.jsは診断専用で、コミット前に削除する。開始・原因特定を兼ねたログ。
