---
date: 2026-10-30 00:20:33
phase: "端末接続"
iteration: 5
status: success
---

## やろうとしたこと

端末WebSocketの準備中の入力・ウィンドウ切替・異常フレーム・リソース解放を改善し、実サービスへ反映した。

## 実際に起きたこと

サーバ55テスト、Web30テスト、TypeScript、production buildが通過した。専用tmuxと実WebSocketで、準備中のstartupが最初のウィンドウへ、直後の日本語入力が切替先へ届くことを確認した。8MiBを超えるフレームでその接続が1009で閉じ、両ウィンドウのNodeプロセスが動いたまま再接続できた。ネイティブ検証は10回反復して成功した。

ブラウザではWebSocketが開いていてもready前は添付・Enter・下書き挿入が無効で、ready後に下書きをそのまま挿入できた。4パネルの非表示・再表示・分割切替、添付の途中失敗・タブ切替、オフライン再接続も通過した。

パッチ適用時にツールが同一ファイルの削除と追加を1回のパッチで受け付けなかった。ファイルは変更されず、Update Fileで適用し直した。

```text
Script error:
apply_patch verification failed: invalid patch: multiple operations target /home/somak/tmux-web/server/src/terminal.js
```

systemctlの再起動処理の終了前にヘルスチェックを行い、一時的な接続拒否が出た。

```text
MainPID=3617334
ActiveState=deactivating
SubState=stop-sigterm
curl: (7) Failed to connect to 127.0.0.1 port 7654 after 0 ms: Connection refused
HTTP 000
```

同じ再起動処理の完了を待ってから再確認した。MainPID=768635、ActiveState=active、SubState=running、未認証の/api/authはHTTP 401。本人のTailscale情報を使ったローカルの信頼境界内の認証付きAPIは200で、実WebSocketの状態フレームとrefresh応答も確認した。個人のログイン名・ホスト名・端末の内容は出力していない。

```json
{"authenticatedLiveAPI":true,"liveEventFrames":2,"refresh":true}
```

## 原因

不正な入力の型検証と非同期処理の順序が不足していた。詳細は2026-10-30-02、初期入力の欠落と実接続検証は2026-10-30-03を参照。

## 試して却下した方法

| 方法 | 結果 | 却下理由 |
| --- | --- | --- |
| PTYのspawn直後にreadyと入力を送る | 実接続でstartupが欠落した | tmuxの最初の出力を受けてから入力を流す |
| WebSocketのopenで接続済みと表示 | tmuxの準備前に添付・Enterを使える | サーバのreadyを待つ |

## 最終的な対応

型を検証してからキューへ追加し、ウィンドウ切替のPromiseを待って次の入力を処理する。待機キューを1MiB/1024件、端末フレームと出力バッファを8MiB、端末サイズを2000列/1000行へ制限する。状態更新のクライアントフレームは64KiBまで。終了時はPTYとリスナーを1度だけ解放し、解放失敗も未処理のPromise拒否にしない。ブラウザはreadyを待ち、準備が10秒以上かかれば再接続する。

## 次にやる人が知っておくべきこと

実サービスは/home/somak/tmux-webのserver/src/index.jsを実行していることを確認して再起動した。今回までの添付・接続改善も反映済み。再現は `node --test server/test/terminal-protocol.test.js` と `CONNECTION_CHECK=1 TERMINAL_READY_CHECK=1 ATTACHMENT_CHECK=1 SCREENS=desktop-four,mobile-panels,offline-panel TEST_OUTPUT=/tmp/tmux-web-terminal-browser PLAYWRIGHT_MODULE=/tmp/dcon-odor-cad-env/lib/python3.12/site-packages/playwright/driver/package node web/test/visual-feedback.cjs after`。実サービスの認証設定は変更していない。
