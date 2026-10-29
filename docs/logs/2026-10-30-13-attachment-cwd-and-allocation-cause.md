---
date: 2026-10-30 01:36:55
phase: "接続後片付け"
iteration: 8
status: partial
---

## やろうとしたこと

一時ミラーの回収漏れを確認する過程で、元のセッション作成ディレクトリが消えた場合の接続も検査した。

## 実際に起きたこと

独立したtmuxサーバーで、実行中のペインを別ディレクトリへ移動してから元ディレクトリを削除した。ペインのプロセスは生きているが、ブラウザー用のPTYクライアントが終了コード1で終了した。PTY生成へ同期例外を注入した別の検査では、一時ミラーが残った。以下は変更前の2件のテスト出力全文。

```text
✖ attachments survive removal of the original session directory without changing the running pane (99.48663ms)
✖ a native PTY startup failure removes only the acquired mirror and preserves the original error (36.369501ms)
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 205.884741

✖ failing tests:

test at server/test/attach.test.js:37:1
✖ attachments survive removal of the original session directory without changing the running pane (99.48663ms)
  AssertionError [ERR_ASSERTION]: tmux client exited before attaching in mirror mode
  
  1 !== null
  
      at file:///home/somak/tmux-web/server/test/attach.test.js:59:16
      at waitFor (file:///home/somak/tmux-web/server/test/attach.test.js:31:15)
      at async TestContext.<anonymous> (file:///home/somak/tmux-web/server/test/attach.test.js:58:7)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:358:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: null,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at server/test/attach.test.js:73:1
✖ a native PTY startup failure removes only the acquired mirror and preserves the original error (36.369501ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  
  + 'original\nwebmux-1330198-2'
  - 'original'
             ^
  
      at TestContext.<anonymous> (file:///home/somak/tmux-web/server/test/attach.test.js:80:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 'original\nwebmux-1330198-2',
    expected: 'original',
    operator: 'strictEqual',
    diff: 'simple'
  }

```

事前の読み取りで存在しないテスト名を指定した際のエラーは以下。実際のネイティブ接続検査はterminal-protocol.test.jsだったため、rg --filesで確認して読み直した。

```text
sed: can't read server/test/terminal-native.test.js: No such file or directory
```

## 原因

PTYは単にtmuxサーバーへ接続するクライアントだが、そのcwdにsession_pathを指定していた。session_pathは作成時のパスであり、ペインが別ディレクトリへ移動しても変わらない。元パスの削除・移動後にクライアントのchdirが失敗する。ミラー作成後の同期例外はcreateAttachmentの返却前に発生するため、呼び出し側がそのリソースを受け取れず回収できない。

## 試して却下した方法

元のディレクトリ削除だけでミラー回収漏れを立証する方法は採らない。この場合はcreateAttachment自体が返り、terminal.jsのonExitから回収できる。接続不能と、取得途中の回収漏れを別々のテストで検証する。

## 最終的な対応

これから、tmuxクライアントだけを安定したディレクトリで起動する。実行中ペインのcwdは変えない。取得済みリソースは関数内部の失敗経路でも破棄し、同時にdisposeされた場合も同じ終了処理を待てるようにする。

## 次にやる人が知っておくべきこと

同期PTYエラーはt.mockで注入しているが、ミラーの作成と一覧確認は本物のtmuxで行っている。元ディレクトリ削除のケースは実際のPTY起動で再現した。双方とも専用の一時ソケットを使い、ユーザーのtmuxには触れていない。
