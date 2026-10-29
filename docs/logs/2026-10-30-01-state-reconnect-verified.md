---
date: 2026-10-30 00:01:19
phase: "接続の改善"
iteration: 4
status: success
---

## やろうとしたこと

WebSocket/RESTの順序競合、切断後の古い応答、無応答の接続、初回のデバイス取得失敗、スリープ復帰を改善した。状態購読をweb/src/state-subscription.tsに分離し、リソース解放と再接続を1接続単位で管理する。

## 実際に起きたこと

Web30テスト、TypeScript、production buildが通過した。新しいブラウザ検証では、先に届いたstream-currentの状態へ遅れてrest-oldが返っても表示が戻らず、デバイス一覧の初回503から操作なしで自動復帰した。取得できていないデバイスの保存タブも残った。タブレット・モバイルの添付回帰と、4パネルの非表示・再表示・分割切替・オフライン再接続も通過し、接続の増殖、実行時エラー、ページの横はみ出しはなかった。

接続ライフサイクルの既存検証を新メニューへ合わせた際、ショートカットのヒント文字列もaccessible nameに含まれるため、exact指定で次の失敗が出た。

```text
locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('menuitem', { name: 'このパネルを広げる / 元に戻す', exact: true })

    at togglePanel (/home/somak/tmux-web/web/test/visual-feedback.cjs:72:192)
    at async /home/somak/tmux-web/web/test/visual-feedback.cjs:189:6 {
  log: [
    "  - waiting for getByRole('menuitem', { name: 'このパネルを広げる / 元に戻す', exact: true })"
  ],
  name: 'TimeoutError'
}
```

メニューラベルの先頭一致へ変更し、同じ検証が成功した。

## 原因

2026-10-29-08参照。加えて、一覧取得前のlocalだけのデバイス情報では、保存済みのremoteタブが消えたかどうかを判断できない。devicesReadyで整理と端末接続を待たせる必要があった。

## 試して却下した方法

| 方法 | 結果 | 却下理由 |
| --- | --- | --- |
| RESTを必ず最後に適用 | WebSocketより古い状態へ戻る | 新しいストリームの内容を保ち、RESTからはメタ情報だけ補完する |
| 接続済みのWebSocketを復帰時も使い続ける | ネットワークが変わると無応答が残る | 復帰時の再接続と30秒の無通信監視・10秒の応答期限を使う |

## 最終的な対応

接続ごとにタイマー・HTTP要求・イベントハンドラを解放する。再接続前の応答を無視し、認証拒否では既存のストリームも閉じる。無応答なら自動再接続し、手動更新では待ち時間を飛ばして再接続する。デバイス一覧は10秒で取得を打ち切り、5秒後に再試行する。ネットワーク復帰でも取得し直す。

## 次にやる人が知っておくべきこと

再現: `CONNECTION_CHECK=1 STATE_CONNECTION_CHECK=1 ATTACHMENT_CHECK=1 SCREENS=desktop-four,mobile-panels,offline-panel TEST_OUTPUT=/tmp/tmux-web-overnight-state-regression PLAYWRIGHT_MODULE=/tmp/dcon-odor-cad-env/lib/python3.12/site-packages/playwright/driver/package node web/test/visual-feedback.cjs after`。合成データのみを使用。実サービスは稼働中で、再起動はまだ行っていない。期限は2026-10-30 04:00 JSTのまま。
