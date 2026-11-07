# デスクトップタブの編集とモニターボタン

PC 1280×800、スマホ390×844、Chromium、倍率1、ja-JP、reduced motion、合成APIデータで確認した。before/afterの通常表示は同じ手順で取得した。新規メニューは名前変更対象を確認するため2つのデスクトップを用意し、未選択タブを対象にした。全画像を1枚ずつ確認した。

| Screen | Before | Finding | Change | After | Result |
| --- | --- | --- | --- | --- | --- |
| PC通常表示 | [画像](../artifacts/visual-feedback/desktop-context/before/remote-entry-desktop.png) | モニターに常時枠・右端に名称編集ボタン | 枠と独立編集ボタンを削除 | [画像](../artifacts/visual-feedback/desktop-context/after/remote-entry-desktop.png) | 枠なし・横溢れなし |
| スマホ通常表示 | [画像](../artifacts/visual-feedback/desktop-context/before/remote-entry-mobile.png) | 上部に不要な編集ボタン | タブ操作へ移動 | [画像](../artifacts/visual-feedback/desktop-context/after/remote-entry-mobile.png) | 上部の余白を確保・44px操作領域 |
| PC右クリック | —（新規状態） | 対象タブの近くで名前変更したい | 右クリックメニュー | [画像](../artifacts/visual-feedback/desktop-context/after/remote-entry-desktop-menu.png) | 未選択タブもそのまま編集可能 |
| スマホ長押し | —（新規状態） | 長押しで名前変更したい | 550msの長押しメニュー | [画像](../artifacts/visual-feedback/desktop-context/after/remote-entry-mobile-menu.png) | 下部メニューから編集可能 |

Chromiumでは実タッチイベントで長押しを検証した。名前変更後の保存と再読み込み、未選択タブの編集時の表示中デスクトップ維持、移動による長押しキャンセル、Shift+F10とEscape、矢印キー、モニターアイコンからの接続も確認した。WebKitでも同じ編集・キャンセル・キーボード・保存テストが成功（長押しは合成PointerEvent）。型検査・production build・webテスト40件成功。

再実行はvisual-feedback.cjsに `DESKTOP_CONTEXT_CHECK=1 SCREENS=remote-entry-desktop,remote-entry-mobile` を設定する。
