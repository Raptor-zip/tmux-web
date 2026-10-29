---
date: 2026-10-30 01:43:33
phase: "ウィンドウ検索"
iteration: 9
status: partial
---

## やろうとしたこと

日本語の変換確定、閉じるボタン上のEscape、閉じた後のフォーカス、検索中のライブ項目削除を変更前ブラウザーで再現する。

## 実際に起きたこと

デスクトップで7つの条件が失敗した。Tabを閉じるボタンから1回押す条件では、今回のfixture上では背景へ出なかった。これを再現済みの不具合として扱わない。Enter・Escape・復元・ライブ項目削除は実際に失敗している。

```text
AssertionError [ERR_ASSERTION]: switcher-desktop keyboard and live state failures
+ actual - expected

+ [
+   'IME confirmation must not select a window',
+   'IME fallback Enter must not select a window',
+   'Escape closes the palette from the close button',
+   'closing restores the opening control',
+   'live removal leaves a selected result',
+   'the combobox identifies the selected option',
+   'Enter still opens a result after live removal'
+ ]
- []

    at /home/somak/tmux-web/web/test/switcher.cjs:56:12
    at async /home/somak/tmux-web/web/test/visual-feedback.cjs:103:21 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: [Array],
  expected: [],
  operator: 'deepStrictEqual',
  diff: 'simple'
}

```

前画像はdesktop/mobile/landscapeを1枚ずつ確認。横はみ出しはないが、同名作業が複数デバイスにある場合、一覧にデバイス名がなく見分けられない。

## 原因

Enterの分岐がisComposing・keyCode 229を確認しない。Escapeは検索inputだけで処理される。divで作ったdialogは自動のフォーカス復元を持たない。選択indexは検索語が変わった場合しかリセットせず、ライブ状態で項目が減ったときに範囲外になる。デバイス情報はSwitchItemへ渡されていなかった。

## 試して却下した方法

タッチ時に検索inputへ強制フォーカスする方法は採らない。一覧を見たいだけでソフトウェアキーボードが開く既存の問題を戻さないため。ネイティブdialog自身へ初期フォーカスする。

## 最終的な対応

これからネイティブdialogで表示し、IME確定のEnterを無視する。ライブ項目数へ選択位置を収め、combobox/listboxの選択関係を明示する。検索語にデバイス名も含め、一覧の補足行で同名作業を識別できるようにする。

## 次にやる人が知っておくべきこと

本物の日本語ソフトウェアキーボードは未操作。ブラウザーへisComposing=trueおよびSafari系のkeyCode=229のKeyboardEventを与えた自動再現である。ChromiumとWebKitで検証する。
