---
date: 2026-10-30 02:40:18
phase: "切替完了確認"
iteration: 11
status: partial
---

## やろうとしたこと

画面幅変更後に4接続へ戻らない検査を、待機時間と各ソケットの切断イベント数で調べる。

## 実際に起きたこと

5秒待っても検査値は3だった。Chromiumでも同じ差が出た。

```text
delayed state, transient device discovery and wake recovery passed
desktop-four {"overflow":false,"visiblePanels":[{"width":480,"headerWidth":347},{"width":480,"headerWidth":414},{"width":480,"headerWidth":414},{"width":480,"headerWidth":414}],"dialogs":[]}
terminal controls wait for tmux readiness and preserve the draft
attachment quoting, upload target and partial-failure recovery passed
mobile-panels {"overflow":false,"visiblePanels":[{"width":390,"headerWidth":198}],"dialogs":[]}
AssertionError [ERR_ASSERTION]: only visible split panels retain websocket connections

3 !== 4

    at /home/somak/tmux-web/web/test/visual-feedback.cjs:165:11 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: 3,
  expected: 4,
  operator: 'strictEqual',
  diff: 'simple'
}

```

各ソケットを追跡すると、開いている4本はすべてcloses=0で、閉じた1本だけcloses=2だった。つまりアプリの接続不足ではなく、fixtureが同じソケットを二度減算していた。

```text
terminal controls wait for tmux readiness and preserve the draft
attachment quoting, upload target and partial-failure recovery passed
mobile-panels {"overflow":false,"visiblePanels":[{"width":390,"headerWidth":198}],"dialogs":[]}
AssertionError [ERR_ASSERTION]: only visible split panels retain websocket connections [{"window":"@1","remote":false,"closes":2},{"window":"@1","remote":true,"closes":0},{"window":"@1","remote":false,"closes":0},{"window":"@2","remote":false,"closes":0},{"window":"@3","remote":false,"closes":0}]

3 !== 4

    at /home/somak/tmux-web/web/test/visual-feedback.cjs:167:11 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: 3,
  expected: 4,
  operator: 'strictEqual',
  diff: 'simple'
}

```

## 原因

onCloseから切断を返す修正でハンドシェイクは完了したが、その両側の通知を同じカウンターへ反映していた。前ログの「150msが短い」という仮説だけでは説明できず、追跡結果で原因を特定した。

## 試して却下した方法

待機時間をさらに延ばすこと、期待する接続数を減らすことはしない。開いている4本を正しく数える必要がある。

## 最終的な対応

これからtransportごとのclosedフラグを使い、切断の処理と減算を一度だけ行う。再度の通知は返答も繰り返さない。5秒の上限付き待機と失敗時のソケット別診断は残す。

## 次にやる人が知っておくべきこと

アプリ側の接続コード変更は不要。欠落した選択応答からの10秒後の復旧は、切断応答修正後の別シナリオで成功している。
