---
date: 2026-10-30 01:08:34
phase: "ファイル操作"
iteration: 6
status: partial
---

## やろうとしたこと

最終レビューで、送信後の自動一覧更新が選択中のプレビューまで取り直すことを確認した。画像を表示しながら別ファイルを送信し、選択中のファイルに変更がなければticketが増えない検証を追加した。

## 実際に起きたこと

```text
AssertionError [ERR_ASSERTION]: background list updates preserve an unchanged preview

3 !== 2

    at /home/somak/tmux-web/web/test/files.cjs:94:16
    at async /home/somak/tmux-web/web/test/visual-feedback.cjs:103:18 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: 3,
  expected: 2,
  operator: 'strictEqual',
  diff: 'simple'
}
```

## 原因

一覧取得後に、選択中のファイルが存在すれば無条件でpreviewを実行していた。動画・音声のURLも変わるため、送信したファイルと無関係なプレビューでも再読み込みされる。モバイルでは選択objectを更新するだけでも一覧へ戻るボタンへフォーカスを動かす可能性がある。

## 試して却下した方法

なし。

## 最終的な対応

明示的な一覧更新ではプレビューも取り直す。自動更新では名前・サイズ・更新時刻・形式が変わった場合だけ取り直し、変わらない選択は保持する。フォルダー変更と削除済みファイルの解除は維持する。

## 次にやる人が知っておくべきこと

この修正は新機能追加後のレビューで検出した挙動を直すもの。画像のケースで同じURLが維持されることを検証し、メディアelementのkeyを変えない。動画の再生自体をこのfixtureで生成・再生しているわけではない。
