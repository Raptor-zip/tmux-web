# ウィンドウ検索の入力と選択保持

2026-10-30。実際のtmuxへ接続しない合成データで、24ウィンドウ・2デバイス・日本語・Tokyo Night・時刻・deviceScaleFactor=1・reduced motionを固定した。前後6枚を1枚ずつ確認した。

| Screen | Before | Finding | Change | After | Result |
| --- | --- | --- | --- | --- | --- |
| デスクトップ1280×800 | [Before](../artifacts/visual-feedback/switcher/before/switcher-desktop.png) | 同名の作業が接続先によらず同じ表示。IME確定で端末が開き、状態更新で選択とスクロールが変わる | 接続先を表示・検索対象へ追加。IMEのEnterを除外し、選択をIDで保持する | [After](../artifacts/visual-feedback/switcher/after/switcher-desktop.png) | 680px幅を維持。接続先が見分けられ、検索欄へ初期フォーカスする |
| 縦向き390×844・タッチ | [Before](../artifacts/visual-feedback/switcher/before/switcher-mobile.png) | 長い検索ヒントが切れ、接続先も分からない | 検索ヒントを短くし、ネイティブdialogの閉じるボタンへ初期フォーカスする | [After](../artifacts/visual-feedback/switcher/after/switcher-mobile.png) | 342px幅を維持。検索ヒントとデバイス名を表示。inputは自動フォーカスされない |
| 横向き740×390・タッチ | [Before](../artifacts/visual-feedback/switcher/before/switcher-landscape.png) | 少ない表示行でも同名作業が重なり、区別しにくい | 接続先を補足行に表示し、一覧の高さを維持する | [After](../artifacts/visual-feedback/switcher/after/switcher-landscape.png) | 680px幅を維持。閉じる操作と一覧スクロールを保ち、横はみ出しなし |

ChromiumとWebKitで3画面それぞれの次の操作を検証した。

- 変換中のEnter、および変換終了直後のkeyCode 229で端末を選ばない。
- 閉じるボタン上でもEscapeで閉じ、開いた操作へフォーカスを戻す。背景の操作へfocusできない。
- 手で動かした一覧のスクロール位置を通常更新で戻さない。
- 状態による並べ替えでも選んだウィンドウを維持し、選択対象の削除後も別の結果を開ける。
- デバイス名で該当する12件だけに絞り込める。検索結果0件でEnterを押しても閉じない。
- comboboxの選択先とlistboxの選択肢が対応する。

WebKitではTabがブラウザー側（activeElementはBODY）へ一度移ってから、次のTabでdialogへ戻る。ネイティブdialogの動作を維持し、背景のボタンをfocusできないことを確認した。

Webの35テスト、TypeScript、production buildも成功。既存の大きなJavaScript chunkのビルド警告は残る。実機のiPhone・ソフトウェアキーボード・スクリーンリーダーの検証は含まない。IMEの検査はKeyboardEventを与える自動再現である。

再現例（Playwrightとブラウザーのパスは環境に合わせる）:

```bash
npm run build
SWITCHER_CHECK=1 NO_SCREENSHOTS=1 \
  SCREENS=switcher-desktop,switcher-mobile,switcher-landscape \
  TEST_OUTPUT=/tmp/switcher-review PLAYWRIGHT_MODULE=/path/to/playwright \
  node web/test/visual-feedback.cjs after
```

WebKitでは `BROWSER_ENGINE=webkit WEBKIT_BIN=/path/to/pw_run.sh` を加える。画像だけを取得する場合は `SWITCHER_CHECK` と `NO_SCREENSHOTS` を外す。
