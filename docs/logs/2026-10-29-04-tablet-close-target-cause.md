---
date: 2026-10-29 23:39:49
phase: "タッチ操作"
iteration: 2
status: partial
---

## やろうとしたこと

添付ブラウザ検証の後、既存fixtureのモバイル→タブレットへのサイズ変更を確認した。

## 実際に起きたこと

```text
AssertionError [ERR_ASSERTION]: tablet touch target {"x":724,"y":51.5,"width":32,"height":44}
    at /home/somak/tmux-web/web/test/visual-feedback.cjs:127:188 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: false,
  expected: true,
  operator: '=='
}
```

## 原因

responsive.css末尾のコンパクトなタブ列のルールが、先行する44pxのタッチ領域を32pxで上書きしている。

## 試して却下した方法

テスト側の44px条件を緩める方法は採用しない。既存のタッチ操作の基準を保つ。

## 最終的な対応

coarse pointer・モバイルの閉じるボタンに44pxを確保する。マウス向けの狭いタブ列は維持する。サイズ変更後も画面の横はみ出しがないかを再確認する。

## 次にやる人が知っておくべきこと

開始・原因特定を兼ねる。添付の修正とは別のUI回帰であり、独立したコミットにする。
