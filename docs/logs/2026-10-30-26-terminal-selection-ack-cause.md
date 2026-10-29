---
date: 2026-10-30 02:21:18
phase: "切替完了確認"
iteration: 11
status: partial
---

## やろうとしたこと

選択完了の応答を保留したとき、添付と下書きの挿入が待つかをブラウザーで再現する。

## 実際に起きたこと

応答前でも挿入ボタンが有効で、下書きが送信・消去された。初回、連続する同じIDへの古い応答、別IDの応答、応答欠落後の復旧も失敗した。以下は変更前の出力全文。

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

+ [
+   'a ready transport still waits for the initial selection acknowledgement',
+   'attachments wait for the current selection to finish',
+   'draft insertion waits for the current selection to finish',
+   'an unfinished selection cannot clear the draft',
+   'the draft is not sent before acknowledgement',
+   'an older acknowledgement for the same window does not unlock the current request',
+   'another window acknowledgement cannot unlock input',
+   'a missing acknowledgement times out and reconnects'
+ ]
- []

    at checkTerminalSelection (/home/somak/tmux-web/web/test/terminal-selection.cjs:61:10)
    at async /home/somak/tmux-web/web/test/visual-feedback.cjs:90:81 {
  generatedMessage: true,
  code: 'ERR_ASSERTION',
  actual: [Array],
  expected: [],
  operator: 'deepStrictEqual',
  diff: 'simple'
}

```

## 原因

readyRefは最初のPTY出力で有効になり、その後の選択要求と結びついていない。入力先の選択は非同期だが、完了の応答と現在要求の番号がない。

## 試して却下した方法

ウィンドウIDだけの照合ではA→B→Aの古いAの応答で早く有効になるため、要求番号も照合する。固定の遅延で挿入を再開する方法も採らない。

## 最終的な対応

これから新サーバーはselectionAck対応をreadyで伝え、選択完了後にrequestIdとwindowIdを返す。ブラウザーは最新の一致する応答まで添付・下書きの挿入を保留し、欠落時は10秒で再接続する。旧サーバーはready後の従来動作を保つ。選択状態を小さなモジュールへ分け、連続要求と旧サーバーを単体検証する。

## 次にやる人が知っておくべきこと

この再現は合成WSで完了通知だけを遅らせたもの。実サーバーの選択完了より前に応答しないことは、別のサーバーテストで検証する。通常のデスクトップキー入力の初回キューを破棄する変更は行わない。
