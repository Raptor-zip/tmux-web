---
date: 2026-10-30 03:21:56
phase: "依存更新"
iteration: 13
status: success
---

## やろうとしたこと

互換範囲内の依存パッチを更新し、lockfileからの再構築と主要操作を検証して稼働反映する。

## 実際に起きたこと

- npm audit fixは確認済みの7パッケージを更新し、余分な1パッケージを削除した。メジャー更新・manifestの範囲変更はない。
- npm ciから再構築できた。サーバー72件（実tmux・ネイティブPTY含む）、Web40件、TypeScript、Vite 6.4.5のproduction buildが成功した。
- npm audit --jsonのmetadataはinfo/low/moderate/high/critical/totalすべて0だった。
- 分離した開発サーバーもbackend 401・Vite 200で起動し、停止後に両ポートが閉じた。専用のtmuxソケットだけを使った。
- ChromiumとWebKitで各9画面、状態復旧・添付・下書き・切り替え完了・再接続・検索・ファイル操作を圧縮配信経由で成功した。実行時エラー・横はみ出しなし。
- 稼働反映後はPID 2160934、active/running。匿名401・本人認証成功、イベント初回/更新2フレームを確認。配信JSのBrotli展開結果も元ファイルと一致した（190489 bytes）。

clean installの出力全文。prebuild-installの非推奨警告はあるが、実際のネイティブ動作と再構築は成功している。

```text
npm warn deprecated prebuild-install@7.1.3: No longer maintained. Please contact the author of the relevant native addon; alternatives are available.

> tmux-web@0.1.0 postinstall
> echo '\n  npm run dev   -> 開発モード (http://localhost:5173)\n  npm run build && npm start -> 本番モード (http://localhost:7654)\n'


  npm run dev   -> 開発モード (http://localhost:5173)
  npm run build && npm start -> 本番モード (http://localhost:7654)


added 224 packages, and audited 227 packages in 3s

41 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

```

## 原因

lockfileが修正前の7パッケージを固定していた。脆弱性の実到達性や攻撃成功を主張するものではなく、現在のnpm監査で指摘されるバージョンを除去した。

## 試して却下した方法

--forceや互換範囲外の更新は不要だった。検証用の開発サーバーは稼働中のポート・tmuxソケットを使わない。

## 最終的な対応

body-parser 1.20.9、concurrently 9.2.5、proxy-addr 2.0.8、qs 6.16.2、shell-quote 1.12.0、source-map-js 1.2.2、Vite 6.4.5をlockfileへ固定した。sourceの変更と混ぜず、この更新を独立してコミットする。

## 次にやる人が知っておくべきこと

npm監査は2026-10-30時点で0件。今後の新しい指摘を保証する値ではない。次はREADMEの操作説明を現行画面へ合わせ、04:00 JSTで最終状態を確認する。
