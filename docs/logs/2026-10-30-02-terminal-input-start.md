---
date: 2026-10-30 00:06:15
phase: "端末接続"
iteration: 5
status: partial
---

## やろうとしたこと

server/src/terminal.jsの接続準備中の入力、非同期ウィンドウ切替、クライアント切断、PTY失敗を調べた。不正フレームを準備中に送る回帰テストを追加して修正前に実行した。

## 実際に起きたこと

`node --test server/test/terminal-connection.test.js` が次の出力で失敗した。

```text
✔ closing while attach is pending disposes the late attachment without sending or replaying input (2.030372ms)
✔ ready connections replay input and dispose only once on error followed by close (0.757545ms)
✖ malformed messages received during attachment never reject the connection or reach the PTY (0.534408ms)
ℹ tests 3
ℹ suites 0
ℹ pass 2
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 100.607265

✖ failing tests:

test at server/test/terminal-connection.test.js:46:1
✖ malformed messages received during attachment never reject the connection or reach the PTY (0.534408ms)
  TypeError: Cannot read properties of null (reading 'type')
      at handleMessage (file:///home/somak/tmux-web/server/src/terminal.js:32:17)
      at connectTerminal (file:///home/somak/tmux-web/server/src/terminal.js:95:26)
      at async TestContext.<anonymous> (file:///home/somak/tmux-web/server/test/terminal-connection.test.js:53:3)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:788:7)
```

## 原因

JSONの型検証より先に準備中のキューへ保存しており、キュー再生はmessageハンドラのtry/catchの外で行う。null.typeのTypeErrorがasync関数からrejectし、index.jsのvoid呼び出しでは処理されない。selectWindowIndexのPromiseも待たないため、直後の入力が前のウィンドウに入る可能性がある。待機キューとローカル端末の出力バッファには上限がない。

## 試して却下した方法

なし。

## 最終的な対応

型とサイズを検証した入力だけをキューへ追加する。ウィンドウ切替と入力を順番に処理し、接続・PTY・切替・解放の失敗を処理する。キューと出力の上限は既存のデバイス中継と揃え、超過時はその接続だけ閉じる。終了時の解放は一度だけ行う。

## 次にやる人が知っておくべきこと

開始と原因特定を兼ねる。実行中のユーザーのtmuxは使わず、偽のPTYと分離したsocketで検証する。現行HEADはeb071a5。期限は04:00 JST。
