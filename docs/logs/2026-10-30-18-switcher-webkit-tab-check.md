---
date: 2026-10-30 01:51:09
phase: "ウィンドウ検索"
iteration: 9
status: partial
---

## やろうとしたこと

Chromiumで成功したキーボード検査をWebKitでも実行する。

## 実際に起きたこと

当初の検査はTab直後のactiveElementが必ずdialog内にあることを要求し、1条件だけ失敗した。

```text
AssertionError [ERR_ASSERTION]: switcher-desktop keyboard and live state failures
+ actual - expected

+ [
+   'Tab from the close button cannot reach the workspace'
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

独立した最小のネイティブdialogでも、閉じるボタンからTabを押すとBODY、次にINPUT、次に閉じるBUTTONへ移った。全期間dialogは:modalに一致しており、背景のbutton.focus()も拒否された。

```text
{ tag: 'BODY', id: '', modal: true }
{ tag: 'INPUT', id: '', modal: true }
{ tag: 'BUTTON', id: 'close', modal: true }
{ backgroundFocusBlocked: true }
```

## 原因

検査がブラウザーUI側への一時的なフォーカス移動を背景操作への漏出と同一視していた。アプリ側で背景へフォーカスが移る不具合は、この検査では再現していない。

## 試して却下した方法

ネイティブdialogへ追加のTabトラップは実装しない。ブラウザーUIへの標準の移動をアプリが阻害する必要はない。

## 最終的な対応

これから検査を、BODYへ移る場合は次のTabでdialogへ戻ること、および背景の操作要素をfocusできないことに修正する。アプリのコード変更は不要。

## 次にやる人が知っておくべきこと

WebKitは環境にインストール済みのpw_run.shを明示して実行している。実際のiPhoneやソフトウェアキーボードの操作は含まない。
