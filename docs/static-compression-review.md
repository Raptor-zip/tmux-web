# 初回表示の転送量を減らす

2026-10-30。JavaScriptとCSSが圧縮要求にも非圧縮で返っていたため、公開アセットの配信へBrotli・gzipを追加した。ブラウザーの受信量は合計860,575 bytesから236,466 bytesへ減り、72.5%の削減を確認した。

| Chromiumの計測 | 変更前 | 変更後 |
| --- | ---: | ---: |
| JavaScriptの転送量 | 698,484 bytes | 190,590 bytes |
| CSSの転送量 | 162,091 bytes | 45,876 bytes |
| 最初のコンテンツ描画（FCP・中央値） | 5,260 ms | 1,544 ms |
| 合成端末の入力準備（中央値） | 5,333 ms | 1,664 ms |

同じフロントエンドのビルド、1280×800、日本語、固定した合成API・WebSocketを使い、Chromiumで各3回計測した。回線条件はダウンロード1.5Mbps・遅延80ms。毎回新しいブラウザーコンテキストを作り、HTTPキャッシュも無効にした。入力準備の時刻は、合成端末の添付ボタンが初めて有効になった時点である。[全サンプル](../artifacts/performance/static-compression/comparison.json)を保存した。

これは条件を固定した初回表示の比較で、実際のデバイスやユーザーのCore Web Vitalsではない。LCP・INP・CLSと実回線での遅延は計測していない。専用DevTools MCPは未提供だったため、Playwrightの受信サイズ・Performance API・実HTTP応答を使った。

実装は[compressionの公式ミドルウェア](https://github.com/expressjs/compression)を公開アセットへ適用する。[Accept-Encoding・VaryのHTTP仕様](https://www.rfc-editor.org/rfc/rfc9110.html#field.accept-encoding)に従う交渉をミドルウェアへ任せ、応答にVaryを付ける。既存のETagと再検証を維持し、Range要求は通常のバイト範囲で返す。小さなファイル、PNG、APIやファイル取得のデータには適用しない。圧縮処理にはサーバー側のCPUを使う。

サーバー72件が成功し、圧縮後のBrotli・gzipを展開して元のファイルとバイト単位で一致することを確認した。非圧縮指定、q=0、Range、HEAD、条件付き取得、予約パスの404も検証した。Chromiumで描画と入力準備、WebKitで画面とファイル操作を確認し、実行時エラーと横はみ出しはなかった。

稼働サーバーではJSがBrotli 190,489 bytes、gzip 199,660 bytes、CSSがBrotli 45,847 bytes、gzip 47,273 bytesだった。ブラウザーの受信量には転送のフレーミング分も含まれる。Tailscale HTTPS経由でもBrotliの応答を展開して元内容との一致を確認した。

再現例（Playwrightのパスは環境に合わせる）:

```bash
COMPRESSED_STATIC=1 THROTTLE_KBPS=1500 THROTTLE_RTT_MS=80 \
  TRANSFER_REPORT=/tmp/asset-transfer.json NO_SCREENSHOTS=1 SCREENS=desktop-controls \
  TEST_OUTPUT=/tmp/asset-transfer PLAYWRIGHT_MODULE=/path/to/playwright \
  node web/test/visual-feedback.cjs after
```

比較用の非圧縮配信では `COMPRESSED_STATIC` を外す。実ユーザーのAPIや端末には接続しない。
