---
date: 2026-10-30 02:02:35
phase: "入力先検証"
iteration: 10
status: partial
---

## やろうとしたこと

番号が別のウィンドウへ再利用された場合と、切り替え後の再接続で使う対象を確かめる。

## 実際に起きたこと

実tmuxで目的のウィンドウを30番へ移し、元の番号に別の入力記録プロセスを置いた。IDを併記したメッセージでも旧サーバーはindexだけを使い、目的のウィンドウには入力が届かなかった。

```text
✔ attachments survive removal of the original session directory without changing the running pane (152.80685ms)
✔ a native PTY startup failure removes only the acquired mirror and preserves the original error (83.750067ms)
✖ an initial window from missing cannot fall back to a different target (58.089779ms)
✖ an initial window from another session cannot fall back to a different target (64.514119ms)
✖ a window ID from another session cannot select a target during an existing attachment (62.993903ms)
✖ real WebSocket input stays on requested windows across startup, renumbering, reconnect and selection failure (392.032755ms)
ℹ tests 6
ℹ suites 0
ℹ pass 2
ℹ fail 4
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 502.023111

✖ failing tests:

test at server/test/attach.test.js:93:3
✖ an initial window from missing cannot fall back to a different target (58.089779ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
      at async TestContext.<anonymous> (file:///home/somak/tmux-web/server/test/attach.test.js:99:7)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: /window.*not found/i,
    operator: 'rejects',
    diff: 'simple'
  }

test at server/test/attach.test.js:93:3
✖ an initial window from another session cannot fall back to a different target (64.514119ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
      at async TestContext.<anonymous> (file:///home/somak/tmux-web/server/test/attach.test.js:99:7)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: /window.*not found/i,
    operator: 'rejects',
    diff: 'simple'
  }

test at server/test/attach.test.js:107:1
✖ a window ID from another session cannot select a target during an existing attachment (62.993903ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
      at async TestContext.<anonymous> (file:///home/somak/tmux-web/server/test/attach.test.js:115:5)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: undefined,
    operator: 'rejects',
    diff: 'simple'
  }

test at server/test/terminal-protocol.test.js:19:1
✖ real WebSocket input stays on requested windows across startup, renumbering, reconnect and selection failure (392.032755ms)
  AssertionError [ERR_ASSERTION]: a reused index cannot redirect input away from the requested ID
  + actual - expected
  
  + '日本語-after-switch'
  - '日本語-after-switch-after-renumber'
                     ^
  
      at TestContext.<anonymous> (file:///home/somak/tmux-web/server/test/terminal-protocol.test.js:98:10)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:358:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: '日本語-after-switch',
    expected: '日本語-after-switch-after-renumber',
    operator: 'strictEqual',
    diff: 'simple'
  }

```

ブラウザー側は切り替え時のメッセージにIDを付けず、同じセッション内で切り替えた後に接続を切ると、再接続URLのwindowが最初の@1へ戻った。現在の選択は@2のままである。

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

+ [
+   'the startup selection includes its window ID',
+   'same-session switching includes its stable window ID',
+   'reconnection requests the currently selected window',
+   'reconnection selects the current window ID',
+   'remote selection messages use the device-local window ID'
+ ]
- []

    at checkTerminalTarget (/home/somak/tmux-web/web/test/terminal-target.cjs:29:10)
    at async /home/somak/tmux-web/web/test/visual-feedback.cjs:87:75 {
  generatedMessage: true,
  code: 'ERR_ASSERTION',
  actual: [Array],
  expected: [],
  operator: 'deepStrictEqual',
  diff: 'simple'
}

```

## 原因

サーバーのパーサーと添付処理がIDを受け渡さない。ブラウザーの再接続start関数がuseEffect開始時のwindowIdを閉じ込め、最新のwindowIdRefをURLに使っていなかった。初回対象の厳密化だけを行うと、最初のウィンドウが削除済みの場合に新しい正常な選択へ再接続できないため、両側の修正が必要。

## 試して却下した方法

IDが無効なとき番号へフォールバックする方法は採らない。番号を再利用した別プロセスへ入力する問題を残すため。

## 最終的な対応

これからIDを初回・通常切り替え・再接続・リモートの各経路で受け渡す。IDを指定したメッセージは形式と長さを検査し、不正な選択後の入力を止める。旧クライアントのindexだけのメッセージは受け付け、tmux失敗は抑制しない。

## 次にやる人が知っておくべきこと

TERMINAL_TARGET_CHECK=1 SCREENS=terminal-targetのブラウザーfixtureは合成WSを使い、実tmuxの検査はserver/test/terminal-protocol.test.jsで別途行う。両方を通して変更を検証する。
