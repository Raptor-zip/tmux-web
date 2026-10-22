# フォーム・装飾の見直し

2026-10-22。既存の合成データを使うブラウザfixtureで検証。実データ・既存ブラウザプロファイルは使用していない。日本語、deviceScaleFactor=1、reduced-motion、Tokyo Night配色を固定し、同じ操作で変更前後を撮影した。

UIは角丸と絵文字を使わず、操作アイコンはSVGに統一する。サイドバーの製品名とブラウザタイトルの製品名接尾辞を削除。ターミナル内の出力は加工しない。

| Screen | Before | Finding | Change | After | Result |
| --- | --- | --- | --- | --- | --- |
| サイドバー・1280×800 | [Before](../artifacts/visual-feedback/forms/before/desktop-controls.png) | デバイスselectがブラウザ既定の灰色。ブランド見出しと丸い枠が目立つ | selectの配色・矢印・高さを統一。ブランド行を削除。角を直角に変更 | [After](../artifacts/visual-feedback/forms/after/desktop-controls.png) | 目視確認済み。横はみ出し・実行時エラーなし |
| プロジェクト・1280×800 | [Before](../artifacts/visual-feedback/forms/before/project-desktop.png) | フォーム・ダイアログの角丸、selectの装飾が不統一 | input・select・textareaの枠、余白、フォーカス表示を共通化。checkboxも直角 | [After](../artifacts/visual-feedback/forms/after/project-desktop.png) | 目視確認済み。selectのキーボード操作も通過 |
| デバイス接続・390×844 | [Before](../artifacts/visual-feedback/forms/before/devices-modal.png) | 入力欄・モーダル・ボタンが角丸、下部のキーボードが文字記号 | 直角のフォームへ統一。装飾をSVGへ変更 | [After](../artifacts/visual-feedback/forms/after/devices-modal.png) | 目視確認済み。44px以上のフォーム高さと表示領域を確保 |
| プロジェクト・390×640 | [Before](../artifacts/visual-feedback/forms/before/project-modal.png) | 小さい画面でもフォームの角丸・矢印が不統一 | 16px文字・44px以上の入力高さ、共通のselect矢印 | [After](../artifacts/visual-feedback/forms/after/project-modal.png) | 目視確認済み。はみ出しなし、操作ボタンを表示 |

文字サイズの下限を8pxから6pxに拡張。行間はxtermの下限1.00を維持し、増減を0.05から0.01刻みに変更した。いずれも「最小にする」で直接指定できる。ブラウザで6px、1.15→1.14→1.00の遷移と描画を検証した。

検証: Web単体テスト15件、TypeScript、production build、上表4状態のブラウザ検証が通過。角のcomputed style、ブランド非表示、selectのスタイル・高さ・キー操作、文字サイズ・行間変更を確認。外部接続やプロジェクト作成処理はfixtureで置き換え、実際の更新操作は行っていない。

再実行（Playwrightは環境に合わせて指定）:

```bash
FORM_CHECK=1 TEST_OUTPUT=/tmp/tmux-web-form-review/after \
  SCREENS=desktop-controls,project-desktop,project-modal,devices-modal \
  PLAYWRIGHT_MODULE=/path/to/playwright node web/test/visual-feedback.cjs after
```
