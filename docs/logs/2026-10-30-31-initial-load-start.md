---
date: 2026-10-30 02:45:22
phase: "初回表示"
iteration: 12
status: partial
---

## やろうとしたこと

web-perfスキルで初回表示の通信量を測り、実測で効果を確認できる改善を行う。

## 実際に起きたこと

専用DevTools MCPのツールは見つからなかった。インストール設定は変更せず、既存Playwrightと実HTTP応答で測る。現在のJS/CSSはbr,gzipを要求してもidentityで返った。

```json
[
  {
    "asset": "index-BJlzUKxi.js",
    "status": 200,
    "encoding": "identity",
    "cacheControl": "public, max-age=0",
    "vary": null,
    "wireBytes": 698484,
    "potentialBrotliBytes": 157246,
    "potentialGzipBytes": 199660
  },
  {
    "asset": "index-uNyYJHbe.css",
    "status": 200,
    "encoding": "identity",
    "cacheControl": "public, max-age=0",
    "vary": null,
    "wireBytes": 162091,
    "potentialBrotliBytes": 31105,
    "potentialGzipBytes": 47273
  }
]
```

Audit Progress:

- [ ] Phase 1: 専用traceツールは未提供。HTTP応答とPlaywrightで継続する。
- [ ] Phase 2: 実利用のCore Web Vitalsは未計測。ローカルの転送量と混同しない。
- [x] Phase 3: Network分析。JS 698484 bytes、CSS 162091 bytes、圧縮なし。
- [ ] Phase 4: この区切りは表示変更なし。既存の画面検査を回帰確認する。
- [x] Phase 5: Viteのminify済み出力をExpress.staticで直接配信している。

## 原因

静的配信にコンテンツ圧縮の処理がなかった。ブラウザー側の圧縮要求に応じず、minify後のJS/CSSも非圧縮で転送する。

## 試して却下した方法

ビルド警告の上限値を変えて問題を見えなくすることはしない。独自の圧縮交渉と事前圧縮ファイル管理も追加しない。既存の公開アセット配信へ実績のあるcompressionミドルウェアを用いる。

## 最終的な対応

未実装。compressionの公式READMEとRFC 9110のAccept-Encodingを確認した。/assetsの圧縮可能なGET/HEADを対象にし、Rangeは通常の表現を維持する。HTTPでbr/gzip/identity、q=0、条件付き要求、元内容との一致を確認してからブラウザーの動作と転送量を測る。

## 次にやる人が知っておくべきこと

potentialBrotliBytesはデフォルト品質でローカル圧縮した見積もりで、配信後の実測ではない。実装ではCPU負荷を抑えた品質設定を用い、配信後に実際のbytesを取り直す。主な参照: https://github.com/expressjs/compression と https://www.rfc-editor.org/rfc/rfc9110.html#field.accept-encoding 。04:00 JSTまで継続する。
