# ファイル操作の見直し

2026-10-30。合成データだけを使い、実ファイル・既存ブラウザプロファイルへは接続していない。日本語、Tokyo Night、deviceScaleFactor=1、reduced motionと時刻を固定した。変更前は1a85c90のWebソースを/tmpでビルドし、同じフォルダー・ファイル・エラー状態・通知で比較した。

| Screen | Before | Finding | Change | After | Result |
| --- | --- | --- | --- | --- | --- |
| 一覧・PC 1280×800 | [Before](../artifacts/visual-feedback/file-browser/before/files-desktop.png) | 一覧・閉じる・余白を確認。旧UIはdivによるモーダル | 標準dialogへ変更し背景へのフォーカス移動を防ぐ | [After](../artifacts/visual-feedback/file-browser/after/files-desktop.png) | 表示位置と幅を維持。フォーカス制御も通過 |
| 一覧・スマホ 390×844 | [Before](../artifacts/visual-feedback/file-browser/before/files-modal.png) | 一覧・入力欄・下部の案内が表示領域に収まることを確認 | 標準dialogでも全画面とsafe areaの設定を適用 | [After](../artifacts/visual-feedback/file-browser/after/files-modal.png) | はみ出しなし。操作ボタンを表示 |
| 送信中・PC | [Before](../artifacts/visual-feedback/file-browser/before/files-desktop-upload.png) | 一部のパンくずと更新が有効。送信を中止する操作がない | 移動・更新をロックし中止を追加。無効ボタンを区別する | [After](../artifacts/visual-feedback/file-browser/after/files-desktop-upload.png) | 送信先を維持。中止後に保存状況を一覧で確認できる |
| 送信中・スマホ | [Before](../artifacts/visual-feedback/file-browser/before/files-modal-upload.png) | 送信先を変えられ、中止できない | 44pxの中止ボタンと移動のロックを追加 | [After](../artifacts/visual-feedback/file-browser/after/files-modal-upload.png) | 狭い幅でも中止と進捗を表示 |
| 画像の失敗・PC | [Before](../artifacts/visual-feedback/file-browser/before/files-desktop-preview-error.png) | 壊れた画像が残り、一覧から選び直す必要がある | 再読み込みを追加し、失敗したメディアを非表示にする | [After](../artifacts/visual-feedback/file-browser/after/files-desktop-preview-error.png) | 新しいURLで表示を回復 |
| 画像の失敗・スマホ | [Before](../artifacts/visual-feedback/file-browser/before/files-modal-preview-error.png) | 一覧へ戻って選び直さないと再試行できない | 再読み込みとダウンロードを操作行へまとめる | [After](../artifacts/visual-feedback/file-browser/after/files-modal-preview-error.png) | 44pxの操作領域。エラー文の横はみ出しなし |
| テキスト・PC | [Before](../artifacts/visual-feedback/file-browser/before/files-desktop-text.png) | iframe内でEscapeが親へ届かない。白い背景の別表示 | ページ内のテキスト表示へ変更。最大256KiBを取得する | [After](../artifacts/visual-feedback/file-browser/after/files-desktop-text.png) | 背景フォーカスを拒否し、Escapeで閉じられる |
| テキスト・スマホ | [Before](../artifacts/visual-feedback/file-browser/before/files-modal-text.png) | iframe内でEscapeが親へ届かない | ページ内表示と一覧へ戻る際のフォーカス復帰を追加 | [After](../artifacts/visual-feedback/file-browser/after/files-modal-text.png) | 内容を選択でき、表示領域内でスクロールできる |

全16画像を1枚ずつ目視確認した。最後の自動更新の修正後も、8枚のAfter画像のSHA-256が直前の確認済み画像と全て一致した。

操作検証はChromiumとWebKitの両方で通過。送信先のロック、中止後の保存状況、複数ファイルの途中失敗、画像再試行、空ファイル、256KiBを超えるテキスト、一覧更新後の選択解除、作業フォルダー変更、背景フォーカス拒否、テキスト内のEscape、閉じた後のフォルダー保存中止を確認した。別ファイルの送信による自動更新では、変更のないプレビューのURLを維持する。

Web35テスト、TypeScript、production buildが通過。Rangeを無視する接続先でも読み込みを256KiBで止め、UTF-8の途中の文字を表示しない。空ファイルへのRangeが416の場合も空のプレビューとして扱う。

再実行（Playwrightとブラウザのパスは環境に合わせる）:

```bash
npm run build
FILES_CHECK=1 SCREENS=files-modal,files-desktop \
  TEST_OUTPUT=/tmp/tmux-web-file-review/after \
  PLAYWRIGHT_MODULE=/path/to/playwright node web/test/visual-feedback.cjs after

BROWSER_ENGINE=webkit WEBKIT_BIN=/path/to/webkit/pw_run.sh NO_SCREENSHOTS=1 \
  FILES_CHECK=1 SCREENS=files-modal,files-desktop \
  TEST_OUTPUT=/tmp/tmux-web-file-webkit \
  PLAYWRIGHT_MODULE=/path/to/playwright node web/test/visual-feedback.cjs after
```

画像・テキスト・ファイル転送を対象にした検証であり、実機のソフトウェアキーボードや内蔵PDFビューアは検証していない。
