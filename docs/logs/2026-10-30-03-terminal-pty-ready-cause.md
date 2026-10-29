---
date: 2026-10-30 00:14:04
phase: "端末接続"
iteration: 5
status: partial
---

## やろうとしたこと

実WebSocketと専用tmux・入力記録用Nodeプロセスで、準備中の入力とタブ切替後の入力の行き先を検証した。

## 実際に起きたこと

最初の実行はテストfixtureが既に発生したlisteningイベントを待ったためタイムアウトした。

```text
✖ real WebSocket input survives startup, reaches the selected tmux window, and oversized frames leave tmux running (15018.05414ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 0
ℹ cancelled 1
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 15133.637291

✖ failing tests:

test at server/test/terminal-protocol.test.js:19:1
✖ real WebSocket input survives startup, reaches the selected tmux window, and oversized frames leave tmux running (15018.05414ms)
  'test timed out after 15000ms'
```

addressで待受状態を確認するよう直したところ、実際の入力の欠落を検出した。

```text
✖ real WebSocket input survives startup, reaches the selected tmux window, and oversized frames leave tmux running (172.760624ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 316.56941

✖ failing tests:

test at server/test/terminal-protocol.test.js:19:1
✖ real WebSocket input survives startup, reaches the selected tmux window, and oversized frames leave tmux running (172.760624ms)
  Error: ENOENT: no such file or directory, open '/tmp/tw-terminal-protocol-rJ4SSI/first-input'
      at async open (node:internal/fs/promises:637:25)
      at async Object.readFile (node:internal/fs/promises:1269:14)
      at async TestContext.<anonymous> (file:///home/somak/tmux-web/server/test/terminal-protocol.test.js:76:16)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:358:3) {
    errno: -2,
    code: 'ENOENT',
    syscall: 'open',
    path: '/tmp/tw-terminal-protocol-rJ4SSI/first-input'
  }
```

## 原因

PTYのspawnが返ってもtmuxクライアントの端末初期化は完了していない。接続readyを先に送り、準備中の入力を即座にpty.writeすると最初の文字が失われる。実験では切替後の入力は2番目のウィンドウへ届いたが、起動直後のstartupは1番目の記録ファイルへ届かなかった。仮説: tmuxがraw modeへ移行する際の端末初期化で入力が破棄される。

## 試して却下した方法

固定sleepは使わない。接続先の負荷で初期化時間が変わるため、実際の初期出力を準備完了の合図として使う。

## 最終的な対応

tmuxの最初のPTY出力を受けてからreadyを通知し、待機中の入力を流す。初期出力もブラウザへ送る。Web側もWebSocketのopenではなくreadyを接続完了として扱う。

## 次にやる人が知っておくべきこと

テストは/tmpの専用tmux socketだけを使う。実サービスはまだ再起動していない。原因はコードで断定せず、確認済みの欠落と端末初期化の仮説を分けている。
