# 接続先クリップボードの直接コピー

操作バーの「この端末へコピー」で、選択中の接続先のテキストを直接コピーする。APIは既存のX11テキスト取得処理を使用。画像・ファイルは対象外。画面のVNC接続状態から独立し、「見るだけ」でもコピーできる。

ブラウザ拒否時は入力パネルを開いて取得した文字を選択する。空・API失敗時はローカルクリップボードを上書きしない。コピー中は連打を防止し、接続先を切り替えて元に戻した場合も古い応答を破棄する。

## 画面比較

Chromium、ja-JP、倍率1、reduced motion、合成プロジェクト・接続エラーの同じ条件を使用。beforeは配置改善完了直後の画像のコピー。全before画像は前の作業で確認済みで、afterは1枚ずつ確認した。

| Screen | Before | Finding | Change | After | Result |
| --- | --- | --- | --- | --- | --- |
| remote-viewer-desktop | [画像](../artifacts/visual-feedback/clipboard/before/remote-viewer-desktop.png) | 直接コピーの入口がない | 常時表示のコピーボタン追加 | [画像](../artifacts/visual-feedback/clipboard/after/remote-viewer-desktop.png) | 重なり・横溢れなし |
| remote-viewer-mobile | [画像](../artifacts/visual-feedback/clipboard/before/remote-viewer-mobile.png) | 直接コピーの入口がない | 常時表示のコピーボタン追加 | [画像](../artifacts/visual-feedback/clipboard/after/remote-viewer-mobile.png) | 重なり・横溢れなし |
| remote-clipboard-mobile | [画像](../artifacts/visual-feedback/clipboard/before/remote-clipboard-mobile.png) | 直接コピーの入口がない | 常時表示のコピーボタン追加 | [画像](../artifacts/visual-feedback/clipboard/after/remote-clipboard-mobile.png) | 重なり・横溢れなし |
| remote-settings-desktop | [画像](../artifacts/visual-feedback/clipboard/before/remote-settings-desktop.png) | 直接コピーの入口がない | 常時表示のコピーボタン追加 | [画像](../artifacts/visual-feedback/clipboard/after/remote-settings-desktop.png) | 重なり・横溢れなし |
| コピー拒否 | —（新しく追加した状態） | 自動コピーを許可されない | 入力パネルを開き文字を選択 | [画像](../artifacts/visual-feedback/clipboard/after/remote-copy-fallback.png) | 手動コピーできる |

## 検証

- 型検査、webの40テスト、production build成功。既存のチャンクサイズ警告は継続。
- ChromiumとWebKitで専用ブラウザテストを実行。日本語・改行・タブ、選択デバイスのAPIルート、閲覧モード、権限拒否と文字選択、空、APIエラー、writeTextのみのブラウザ、接続先切替時の古い結果の破棄を確認。
- ブラウザのクリップボードはメモリ上のスタブに差し替え、実機の個人データを読んだりホストのクリップボードを上書きしていない。実機VNC・実際の権限ダイアログはこのテストの対象外。

再実行：既存のvisual-feedback.cjsに `REMOTE_CLIPBOARD_CHECK=1 SCREENS=remote-viewer-desktop` を設定する。スクリーンショット不要時は `NO_SCREENSHOTS=1`、WebKitは `BROWSER_ENGINE=webkit WEBKIT_BIN=/path/to/pw_run.sh` を追加。
