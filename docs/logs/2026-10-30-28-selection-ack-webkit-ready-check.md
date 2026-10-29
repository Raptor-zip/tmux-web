---
date: 2026-10-30 02:38:41
phase: "切替完了確認"
iteration: 11
status: partial
---

## やろうとしたこと

新しい選択完了確認と、既存のモバイル添付・分割復元をWebKitで検証する。

## 実際に起きたこと

添付と下書きの検査は成功した。画面を広げた直後の接続数だけが3対4で失敗した。

```text
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

## 原因

仮説: fixtureは画面幅変更後に150msだけ待ってWebSocketの接続数を読んでおり、WebKitで残り1接続が開く前に判定している。アプリ側の失敗か、検査の待機条件かは、接続が揃うのを待って確かめる。

## 試して却下した方法

期待する接続数を3に減らすことはしない。4パネルを表示した場合に4接続へ戻る要件を維持する。

## 最終的な対応

これから画面幅変更後の接続数を最大5秒待ち、その後に4接続であることを検査する。接続が揃わなければアプリ側の原因調査を続ける。

## 次にやる人が知っておくべきこと

WebKitの新しい選択完了のシナリオは、この先のsceneなので最終確認はまだ。Chromiumとネイティブ検査は別ログへ記録している。
