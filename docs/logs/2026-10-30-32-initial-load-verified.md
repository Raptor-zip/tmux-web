---
date: 2026-10-30 03:07:13
phase: "初回表示"
iteration: 12
status: success
---

## やろうとしたこと

初回表示の公開アセットを圧縮し、元内容との一致、ブラウザーの表示、転送量と描画時間を確認する。

## 実際に起きたこと

- サーバー72件が成功。Brotli/gzipの復元一致、非圧縮指定、q=0、Range、HEAD、ETag、予約パスの404を検証した。
- ChromiumのJS/CSS転送量は860575→236466 bytes、72.5%減。ダウンロード1.5Mbps・遅延80ms・cold contextの各3回で、FCP中央値5260→1544ms、合成端末の入力準備5333→1664msだった。
- WebKitでも圧縮したビルドから画面とファイル操作が正常に動いた。実行時エラー・横はみ出しなし。
- 稼働サーバーはPID 2059987、active/running。匿名認証401、本人認証成功、イベント初回・明示更新の2フレームを確認。
- 稼働HTTPでbr/gzip/identityを受信し、展開後のJS/CSSがローカルファイルとバイト一致。Tailscale HTTPS経由のBrotliでも一致した。

依存追加時のnpm出力全文。既存の指摘対象パッケージのバージョンは追加前と同じで、新しい圧縮依存の導入によるものではない。更新は次の区切りで扱う。

```text

added 6 packages, and audited 228 packages in 612ms

40 packages are looking for funding
  run `npm fund` for details

3 vulnerabilities (1 moderate, 1 high, 1 critical)

To address all issues, run:
  npm audit fix

Run `npm audit` for details.

```

## 原因

minifyしたJS/CSSをExpress.staticで直接送り、圧縮交渉を行っていなかった。

## 試して却下した方法

ビルド警告の閾値変更、独自の圧縮交渉、事前圧縮ファイルの管理は追加しない。標準ミドルウェアを公開アセットへ絞って使う。

## 最終的な対応

installWebへ公開配信をまとめ、compression 1.8.2を追加した。Rangeは圧縮せず、API・ファイルデータへ適用しない。存在しないassetsや予約パスはapp shellへ回さない。更新時に依存を揃えるためREADMEへnpm ciを追記した。測定条件・全サンプル・再現手順は [配信レビュー](../static-compression-review.md) に保存した。

## 次にやる人が知っておくべきこと

実利用のLCP/INP/CLSは未計測。今回の時間は合成API・WSと回線条件を固定したFCP・入力準備で、実機の値ではない。次は既存依存のパッチ更新を独立して行い、04:00 JSTまで改善を継続する。
