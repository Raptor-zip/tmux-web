---
date: 2026-10-30 01:58:38
phase: "入力先検証"
iteration: 10
status: partial
---

## やろうとしたこと

切り替え失敗と初回接続の対象違いを実tmuxで再現し、入力の宛先を検証する。

## 実際に起きたこと

存在しないindexへの切り替え直後に送った文字列が、以前のウィンドウの記録ファイルへ追記された。初回接続では消えたwindowIdと別セッションのwindowIdが両方受理され、別の対象へ接続された。以下は変更前の失敗全文。

```text
✔ attachments survive removal of the original session directory without changing the running pane (124.519828ms)
✔ a native PTY startup failure removes only the acquired mirror and preserves the original error (76.366254ms)
✖ an initial window from missing cannot fall back to a different target (59.777302ms)
✖ an initial window from another session cannot fall back to a different target (67.653224ms)
✖ real WebSocket input survives startup, reaches the selected tmux window, and oversized frames leave tmux running (346.443344ms)
ℹ tests 5
ℹ suites 0
ℹ pass 2
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 433.793112

✖ failing tests:

test at server/test/attach.test.js:93:3
✖ an initial window from missing cannot fall back to a different target (59.777302ms)
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
✖ an initial window from another session cannot fall back to a different target (67.653224ms)
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

test at server/test/terminal-protocol.test.js:19:1
✖ real WebSocket input survives startup, reaches the selected tmux window, and oversized frames leave tmux running (346.443344ms)
  AssertionError [ERR_ASSERTION]: a failed switch never replays pending input to the old window
  + actual - expected
  
  + 'startup-reconnected-must-not-reach-previous-window'
  - 'startup-reconnected'
                        ^
  
      at TestContext.<anonymous> (file:///home/somak/tmux-web/server/test/terminal-protocol.test.js:92:10)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:358:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 'startup-reconnected-must-not-reach-previous-window',
    expected: 'startup-reconnected',
    operator: 'strictEqual',
    diff: 'simple'
  }

```

## 原因

実際のtmux選択がallowFailure=trueでエラーを抑制し、terminal.jsの直列キューが成功として後続入力へ進む。初回選択はグローバル一覧からindexを取るだけで、対象セッションとの関係も不存在も検証しない。通常の切り替えもindexだけなので、採番変更や番号再利用の際に意図する対象を区別できない。

## 試して却下した方法

入力を一定時間遅らせる方法は採らない。指定対象を識別して選択が完了したことが必要で、時間待ちでは失敗や番号再利用を解決できない。

## 最終的な対応

これから初回のwindowIdを対象セッション内で検証し、選択時のtmux失敗を呼び出し側へ伝える。ブラウザーの全切り替え経路へwindowIdを加え、サーバーはIDがある場合にindexへフォールバックしない。古いクライアントのindexだけの操作は維持するが、失敗時は閉じて入力を破棄する。

## 次にやる人が知っておくべきこと

再現は専用tmuxサーバー内の合成プロセスだけを使用。ユーザーの既存端末へ検査文字列を送っていない。今後の検査には、番号を移動して元の番号へ別プロセスを置く実際の再採番を含める。
