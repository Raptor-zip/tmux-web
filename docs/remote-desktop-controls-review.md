# リモートデスクトップ操作の確認

PC 1280×800、スマホ390×844。Chromium、倍率1、ja-JP、reduced motion、合成プロジェクトと接続エラー表示で比較。既存visual-feedback.cjsのAPIフィクスチャを使用。接続成功と実機のキー送信はこの画面比較の対象外。

| Screen | Before | Finding | Change | After | Result |
| --- | --- | --- | --- | --- | --- |
| remote-entry-desktop | [画像](../artifacts/visual-feedback/before/remote-entry-desktop.png) | 入口がメニュー内に隠れている | 共通バーに名前付き入口 | [画像](../artifacts/visual-feedback/after/remote-entry-desktop.png) | 重なり・ページ横溢れなし |
| remote-entry-mobile | [画像](../artifacts/visual-feedback/before/remote-entry-mobile.png) | スマホでも入口に名前がない | 常時見える文字付き入口 | [画像](../artifacts/visual-feedback/after/remote-entry-mobile.png) | 重なり・ページ横溢れなし |
| remote-viewer-desktop | [画像](../artifacts/visual-feedback/before/remote-viewer-desktop.png) | 状態と操作が曖昧で再接続も隠れている | 接続状態・モード・表示・入力に整理 | [画像](../artifacts/visual-feedback/after/remote-viewer-desktop.png) | 重なり・ページ横溢れなし |
| remote-viewer-mobile | [画像](../artifacts/visual-feedback/before/remote-viewer-mobile.png) | 表示・操作モードを判別しづらい | 44px以上のボタンと明示的な選択 | [画像](../artifacts/visual-feedback/after/remote-viewer-mobile.png) | 重なり・ページ横溢れなし |
| remote-clipboard-mobile | [画像](../artifacts/visual-feedback/before/remote-clipboard-mobile.png) | 文字入力に複数段階の操作が必要 | 入力・コピーを直接開くボタン | [画像](../artifacts/visual-feedback/after/remote-clipboard-mobile.png) | 重なり・ページ横溢れなし |
| remote-settings-desktop | [画像](../artifacts/visual-feedback/before/remote-settings-desktop.png) | その他操作の展開分も高さを使う | 設定を直接開き接続情報は折りたたむ | [画像](../artifacts/visual-feedback/after/remote-settings-desktop.png) | 重なり・ページ横溢れなし |

全12画像を1枚ずつ確認。スマホの倍率文言が初回確認で見切れたため、モード幅と選択欄の文字サイズを調整し再撮影・再確認した。型検査、webの40テスト、production build成功。既存500kBチャンク警告は継続。

追加依頼の接続先クリップボード直接コピーは次の作業単位で追加する。
