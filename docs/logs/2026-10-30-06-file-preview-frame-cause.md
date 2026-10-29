---
date: 2026-10-30 00:42:14
phase: "ファイル操作"
iteration: 6
status: partial
---

## やろうとしたこと

標準dialogへ変更し、テキストプレビューへフォーカスしてEscapeで閉じる操作を実ブラウザで確認した。

## 実際に起きたこと

送信中止・途中失敗・画像の再読み込みまでは進んだが、iframeにフォーカスした状態のEscapeで閉じられず、次の失敗になった。

```text
locator.waitFor: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for getByRole('dialog', { name: 'ファイル一覧とプレビュー' }) to be hidden[22m
[2m    63 × locator resolved to visible <dialog open="" role="dialog" aria-modal="true" aria-label="ファイル一覧とプレビュー" class="file-browser has-preview">…</dialog>[22m

    at /home/somak/tmux-web/web/test/files.cjs:96:20
    at async /home/somak/tmux-web/web/test/visual-feedback.cjs:101:18 {
  log: [
    "  - waiting for getByRole('dialog', { name: 'ファイル一覧とプレビュー' }) to be hidden",
    '    63 × locator resolved to visible <dialog open="" role="dialog" aria-modal="true" aria-label="ファイル一覧とプレビュー" class="file-browser has-preview">…</dialog>'
  ],
  name: 'TimeoutError'
}
```

## 原因

iframeは別のドキュメントであり、フォーカスしていると親へのキーボードイベントが届かない。標準dialogだけではこのケースを解消できなかった。サーバのCSP sandboxは維持する必要があり、子フレームへスクリプトを挿入して回避する方法は使わない。

## 試して却下した方法

| 方法 | 結果 | 却下理由 |
| --- | --- | --- |
| 標準dialogだけで既存のテキストiframeを包む | Escapeで閉じられなかった | ページ内のテキスト表示へ変更する必要がある |

## 最終的な対応

テキストは認証付きURLから先頭256KiBまでを取得し、Reactのpre要素で表示する。文字列として描画してスクリプトを実行しない。Rangeと読み込み量の上限、UTF-8の切れ目、中止・空ファイルを検証する。PDFの表示経路は別に検証する。

## 次にやる人が知っておくべきこと

方針変更と原因特定を兼ねる。画面比較は同じ状態に揃えるため、プレビュー失敗の撮影前に両方とも一覧を開き直して送信通知を消す。変更前コードはHEADのスナップショットを/tmpでビルドして再撮影する。
