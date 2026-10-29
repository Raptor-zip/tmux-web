# 切り替え完了まで下書きを保持する

2026-10-30。2タブ・合成WebSocket・日本語・Tokyo Night・390×844・タッチ入力・deviceScaleFactor=1・固定時刻・reduced motionで、選択完了の応答を保留した。前後の画像は1枚ずつ確認した。実ユーザーの端末や入力内容は使っていない。

| Screen | Before | Finding | Change | After | Result |
| --- | --- | --- | --- | --- | --- |
| モバイル・切り替え応答待ち | [Before](../artifacts/visual-feedback/terminal-selection/before/terminal-selection-waiting.png) | 最初のready後は切り替え完了を待たずに挿入でき、下書きが消える | 最新の要求番号とウィンドウIDに一致する完了通知まで、添付・挿入を待つ | [After](../artifacts/visual-feedback/terminal-selection/after/terminal-selection-waiting.png) | 下書きを保持し、「切り替え中」を表示。添付・挿入が無効。横はみ出しなし |

ChromiumとWebKitで、初回の選択待ち、下書き保持、A→B→Aの古い応答、別ウィンドウの応答、10秒の応答欠落と再接続後の新しい確認を検証した。添付・準備中の下書き・タブの入力先・モバイルから分割画面への復元も両ブラウザーで成功した。Chromiumでは遅い状態応答・一時的なデバイス取得失敗・復帰時の状態保持も確認した。

サーバー68件、Web40件、TypeScript、production buildが成功。実tmuxを使う入力先・完了通知の統合検査も10回連続で成功した。サーバーは選択処理の完了後に通知し、失敗時は通知せず入力を止める。配信が詰まった場合の上限も完了通知に適用する。

新サーバーは完了通知への対応を明示する。古いサーバーと接続する場合は従来のready動作を維持する。通常のデスクトップキー入力を受ける既存のサーバーキューは保持した。実機のiPhoneや日本語ソフトウェアキーボードは未検証。

再現例（パスは環境に合わせる）:

```bash
npm run build
TERMINAL_SELECTION_CHECK=1 NO_SCREENSHOTS=1 SCREENS=terminal-selection \
  TEST_OUTPUT=/tmp/terminal-selection-review PLAYWRIGHT_MODULE=/path/to/playwright \
  node web/test/visual-feedback.cjs after
```

WebKitでは `BROWSER_ENGINE=webkit WEBKIT_BIN=/path/to/pw_run.sh` を加える。画像取得時は `NO_SCREENSHOTS` を外す。タイムアウトは実時間で確認するため、1回の実行に約15秒かかる。
