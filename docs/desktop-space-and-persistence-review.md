# リモート画面の拡張とターミナル接続の保持

## 画面比較

Chromium、倍率1、ja-JP、reduced motion、PC 1280×800、スマホ390×844、横向き740×390。`visual-feedback.cjs` の合成プロジェクトと接続失敗APIを使用し、実際の画面・個人情報は取得していない。beforeは変更前の `513ac98` を別ディレクトリに展開・ビルドした。同じ操作でafterを取得し、画像は1枚ずつ確認した。画面領域の比率は `.desktop-stage` の面積÷ブラウザ表示面積であり、元の画面との縦横比による黒帯は含む。

| Screen | Before | Finding | Change | After | Result |
| --- | --- | --- | --- | --- | --- |
| PC通常表示 | [画像](../artifacts/visual-feedback/desktop-space/before/remote-viewer-desktop.png) | 操作欄と外周余白で表示領域62.5% | 外周余白・常設フッターを廃止、44pxの1段バー | [画像](../artifacts/visual-feedback/desktop-space/after/remote-viewer-desktop.png) | 94.5%、横溢れなし |
| スマホ通常表示 | [画像](../artifacts/visual-feedback/desktop-space/before/remote-viewer-mobile.png) | 常設操作欄が約半分を占有、表示領域52.2% | 52pxの1段バー、44pxの操作領域 | [画像](../artifacts/visual-feedback/desktop-space/after/remote-viewer-mobile.png) | 93.8%、横溢れなし |
| スマホ横向き | [画像](../artifacts/visual-feedback/desktop-space/before/remote-viewer-landscape.png) | 表示領域38.2%、再接続ボタンも見切れる | 追加操作を重ねて表示 | [画像](../artifacts/visual-feedback/desktop-space/after/remote-viewer-landscape.png) | 86.7%、メッセージ・ボタン表示良好 |
| スマホ文字入力 | [画像](../artifacts/visual-feedback/desktop-space/before/remote-clipboard-mobile.png) | 入力欄を開くと表示領域33.7% | 右上の閉じられるパネルに変更 | [画像](../artifacts/visual-feedback/desktop-space/after/remote-clipboard-mobile.png) | 元画面を縮小せず、入力へフォーカス移動 |
| PC画質設定 | [画像](../artifacts/visual-feedback/desktop-space/before/remote-settings-desktop.png) | 設定を開くと表示領域33.6% | 設定を閉じられるパネルに変更 | [画像](../artifacts/visual-feedback/desktop-space/after/remote-settings-desktop.png) | 元画面の寸法維持、設定・適用ボタンの見切れなし |
| コピー許可なし | —（追加検証） | コピー拒否時の手動操作が必要 | 受信文字を選択し、通知を画面下に重ねる | [画像](../artifacts/visual-feedback/desktop-space/after/remote-copy-fallback.png) | 文字選択・案内・「見るだけ」表示良好 |

追加操作の開閉でVNCの表示寸法や接続を変更しない。「操作・設定」に操作モード、表示倍率、コピー、画質、特殊キー、再接続、操作ガイドを移動した。文字入力・全画面・閉じるは常に利用できる。パネルの開閉でフォーカスを移動・復元し、Escapeはパネルを先に閉じる。リモート画面内のEscape/Tabは従来どおり接続先に送る。

## ターミナル接続

訪問済みのタブごとにxtermとWebSocketを保持する。タブ、アプリのデスクトップ、ブラウザタブ、パネルの拡大表示を切り替えても切断しない。復帰時は保存済みの内容を表示し、必要なサイズ計測と再描画だけを行う。未訪問タブは最初に選択した時点で接続し、タブを閉じると接続を破棄する。実際に通信が切れた場合の再接続は継続する。

`direct` モードはtmuxのウィンドウ選択を共有するため、表示したタブを復帰時に選び直す。非表示タブは接続の再確立や番号変更時に前面のウィンドウを奪わない。`mirror` モードでは各タブの画面を独立して保持する。

## 検証

- Webの単体テスト55件、TypeScript型検査、production build。
- ブラウザでタブ別の画面保持、訪問済みタブ・デバイス間の切替時の接続数維持、実切断からの回復、タブを閉じた際の接続解放。
- デスクトップ・ブラウザタブ・パネル拡大の切替反復でも接続数が増えないこと。
- 既存の選択確認応答・入力待ち・タイムアウト、モバイル接続待ち、デスクトップ間ドラッグ・保存・再読み込みの回帰テスト。
- directモードの復帰時ウィンドウ選択、非表示中の実切断回復で前面の選択を変更しないこと、入力先。
- 5画面の表示領域、追加パネル表示時の寸法維持、Escape、入力下書き保持、フォーカス移動・復元、ページ横溢れ・実行時エラーなし。
- 接続先別のコピー、日本語・改行、閲覧専用、ブラウザによるコピー拒否、空文字、API失敗、遅延応答時の接続先変更。

画面比較は合成APIによる接続失敗状態で行った。実機VNCへの接続や実機スマホのソフトウェアキーボードは、この比較では検証していない。

再実行：`PLAYWRIGHT_MODULE` にPlaywrightモジュールのパスを設定し、`REMOTE_COMPACT_CHECK=1 REMOTE_CLIPBOARD_CHECK=1 SCREENS=remote-viewer-desktop,remote-viewer-mobile,remote-viewer-landscape,remote-clipboard-mobile,remote-settings-desktop node web/test/visual-feedback.cjs after`。`STATIC_ROOT` と `TEST_PORT` で検証用ビルド・ポートを指定できる。ターミナルは `TERMINAL_TARGET_CHECK=1 SCREENS=terminal-target`、`CONNECTION_CHECK=1 SCREENS=desktop-four`、`TERMINAL_WAKE_CHECK=1 SCREENS=terminal-target` を使用する。
