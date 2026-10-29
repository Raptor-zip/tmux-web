---
date: 2026-10-30 03:10:59
phase: "依存更新"
iteration: 13
status: partial
---

## やろうとしたこと

圧縮追加前から存在するnpm監査の指摘を、現在のメジャーと宣言済みの互換範囲を保って更新する。

## 実際に起きたこと

ルートのnpm auditは7パッケージ（moderate 1、high 3、critical 3）を報告した。圧縮追加の前後で指摘対象のバージョンは同じだった。dry-runの更新計画は次のとおり。

```json
[
  {
    "name": "vite",
    "before": "6.4.3",
    "after": "6.4.5"
  },
  {
    "name": "source-map-js",
    "before": "1.2.1",
    "after": "1.2.2"
  },
  {
    "name": "shell-quote",
    "before": "1.9.0",
    "after": "1.12.0"
  },
  {
    "name": "qs",
    "before": "6.16.0",
    "after": "6.16.2"
  },
  {
    "name": "proxy-addr",
    "before": "2.0.7",
    "after": "2.0.8"
  },
  {
    "name": "concurrently",
    "before": "9.2.4",
    "after": "9.2.5"
  },
  {
    "name": "body-parser",
    "before": "1.20.8",
    "after": "1.20.9"
  }
]
```

dry-runはJSONの前に変更予定のテキスト行も出したため、最初の解析が次で失敗した。出力を確認してJSON部分だけを解析し、実ファイルの変更がないことを確認した。

```text
<anonymous_script>:1
change vite 6.4.3 => 6.4.5
^

SyntaxError: Unexpected token 'c', "change vit"... is not valid JSON
    at JSON.parse (<anonymous>)
    at file:///home/somak/tmux-web/[eval1]:2:17

Node.js v24.13.0
```

## 原因

lockfileが修正前のbody-parser、proxy-addr、shell-quote、qs、source-map-js、Vite等を固定していた。公式のGitHub Advisoryでbody-parser 1.20.9、proxy-addr 2.0.8、shell-quote 1.11.0以降の修正を確認した。実際の経路で悪用可能という主張はせず、指摘対象の依存を更新する。

## 試して却下した方法

--forceで互換範囲外へ更新する方法は採らない。アプリのソースと混ぜず、互換範囲内の7パッケージを更新して検証する。

## 最終的な対応

これから確認した計画でnpm audit fixを行い、npm ciから全テスト・型検査・ビルド・主要ブラウザー操作を確認する。extraneousな@homebridge/node-addon-apiの削除候補があるため、実ネイティブPTYも検査する。

## 次にやる人が知っておくべきこと

参照: https://github.com/advisories/GHSA-27r3-jxmh-p828 、https://github.com/advisories/GHSA-jqcg-44mw-7w3h 、https://github.com/advisories/GHSA-pqg4-j6r4-53mv 。再現用の悪用コードは実行しない。04:00 JSTまで改善を継続する。
