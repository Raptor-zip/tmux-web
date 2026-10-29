---
date: 2026-10-30 01:47:26
phase: "ウィンドウ検索"
iteration: 9
status: partial
---

## やろうとしたこと

最初の修正をデスクトップとタッチで検証し、入力中に届くライブ更新による操作への影響も確認する。

## 実際に起きたこと

デスクトップの当初の再現条件は成功したが、dialog自身へautofocusを付けてもChromiumはinputに初期フォーカスした。独立した最小HTMLでも `{ coarse: true, attribute: '', property: true, active: 'INPUT' }` を確認。閉じるbuttonにautofocusを付けると `{ active: 'BUTTON', inside: true }` になった。

```text
switcher-desktop: composition, native focus, restoration, empty search and live removal passed
switcher-desktop {"overflow":false,"visiblePanels":[{"width":1280,"headerWidth":1147}],"dialogs":[{"label":"ウィンドウを切り替える","width":680}]}
AssertionError [ERR_ASSERTION]: switcher-mobile keyboard and live state failures
+ actual - expected

+ [
+   'touch opening does not force the software keyboard'
+ ]
- []

    at /home/somak/tmux-web/web/test/switcher.cjs:56:12
    at runNextTicks (node:internal/process/task_queues:64:5)
    at process.processImmediate (node:internal/timers:472:9)
    at async /home/somak/tmux-web/web/test/visual-feedback.cjs:103:21 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: [Array],
  expected: [],
  operator: 'deepStrictEqual',
  diff: 'simple'
}

```

追加検査では、一覧を手でスクロールした後の更新で先頭へ引き戻され、状態による並べ替えで選択対象も変わった。

```text
AssertionError [ERR_ASSERTION]: switcher-desktop keyboard and live state failures
+ actual - expected

+ [
+   'live updates preserve manual list scrolling',
+   'status reordering keeps the chosen window selected'
+ ]
- []

    at /home/somak/tmux-web/web/test/switcher.cjs:75:12
    at runNextTicks (node:internal/process/task_queues:64:5)
    at process.processImmediate (node:internal/timers:472:9)
    at async /home/somak/tmux-web/web/test/visual-feedback.cjs:103:21 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: [Array],
  expected: [],
  operator: 'deepStrictEqual',
  diff: 'simple'
}

```

## 原因

ネイティブdialogの初期フォーカス手順ではdialogのautofocusだけで子inputへの移動を止められなかった。選択をindexで記憶しているため状態ソートが対象を変える。スクロール補正のeffectがrows配列に依存し、同じ項目の通常更新でも選択行へ戻していた。

## 試して却下した方法

dialog自身へのautofocusは実ブラウザーで失敗した。開いた後にinputをblurする方法も、ソフトウェアキーボードが一度開く可能性を残すため採らない。

## 最終的な対応

これからタッチ時の初期autofocusを閉じるbuttonへ指定する。選択はウィンドウIDで維持し、項目削除時は存在する結果へ戻す。スクロール補正は選択IDと検索語の変更時に限定する。

## 次にやる人が知っておくべきこと

一覧にデバイス名を加えた検索は、この時点でDGX Sparkの12件だけを返す検査に通っている。画面の最終比較は全条件が成功してから取得する。
