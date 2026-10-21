# レスポンシブUX改善の検証

2026-10-21。比較元は `e60325d`。文脈を共有していない独立エージェントが、最初のスクリーンショットとソースを批評し、実装後も再批評した。

## 撮影条件

`web/test/visual-feedback.cjs` は既存の本番ビルドをローカル静的サーバーで開き、API・WebSocketだけをブラウザ内で合成データへ差し替える。実際のtmux、実プロジェクト、既存ブラウザプロファイルは使用しない。固定日時、日本語ロケール、倍率1、ダークテーマ、reduced-motion、同じ初期配置・同じ操作を使用。モバイル縦横のみtouch context、残りは通常context。タブレットの44px操作領域は別途touch contextを900pxへリサイズして測定。

Beforeは別の一時ディレクトリに `git archive e60325d` したソースをビルドしたもの。Afterは今回のビルド。`Alt+Enter`はBeforeでは機能せず、Afterでは集中表示になる。同じキー操作で新機能の差を示している。

## 画面比較

すべてのBefore/After画像を1枚ずつ画像ツールで目視確認。横方向のページはみ出し・未処理の実行時エラーは全12ケースで0件。

| Screen | Before | Finding | Change | After | Result |
| --- | --- | --- | --- | --- | --- |
| 1920×1080・4分割 | [画像](../artifacts/visual-feedback/before/desktop-four.png) | 各パネルで2つのセレクトが反復し、作業名を圧迫 | セレクトを追加メニューと検索一覧へ統合、作業名を2行表示 | [画像](../artifacts/visual-feedback/after/desktop-four.png) | 確認済み |
| 1280×800・4分割 | [画像](../artifacts/visual-feedback/before/laptop-four.png) | タイトル領域が約24pxしかない | 約219〜254pxを確保、明確な選択タブ・入力先、集中表示から復帰 | [画像](../artifacts/visual-feedback/after/laptop-four.png) | 確認済み |
| 900×1024・サイドバー＋2分割 | [画像](../artifacts/visual-feedback/before/tablet-two.png) | パネル幅296pxに対しタイトル領域12px | 左の固定レールを省き各パネル320px、タイトル252px以上 | [画像](../artifacts/visual-feedback/after/tablet-two.png) | 確認済み |
| 390×844・4パネル | [画像](../artifacts/visual-feedback/before/mobile-panels.png) | 他のパネルに到達する入口がなく、入力欄が常時展開 | 全パネル検索・切替、入力欄を展開式に、タッチ操作44px | [画像](../artifacts/visual-feedback/after/mobile-panels.png) | 確認済み |
| 740×390・横向き | [画像](../artifacts/visual-feedback/before/mobile-landscape.png) | 入力欄と補助キーで端末本文の高さが約22px | 入力欄を畳み、端末本文の高さを約130pxへ拡大 | [画像](../artifacts/visual-feedback/after/mobile-landscape.png) | 確認済み |
| 1100×800・12タブ | [画像](../artifacts/visual-feedback/before/many-tabs.png) | タブ名が短く、選択タブが埋もれる | タイトルと作業名、選択下線、件数ボタンと検索、矢印キーのフォーカス | [画像](../artifacts/visual-feedback/after/many-tabs.png) | 確認済み |
| 1280×800・Alt+Enter | [画像](../artifacts/visual-feedback/before/focus-panel.png) | パネルを一時的に拡大できない | 接続と分割配置を維持した集中表示・復帰 | [画像](../artifacts/visual-feedback/after/focus-panel.png) | 確認済み |
| 390×844・接続設定 | [画像](../artifacts/visual-feedback/before/devices-modal.png) | 長いURLと閉じる操作の収まりを確認 | 改行可能なURLを維持し、閉じる操作のタッチ領域を確保 | [画像](../artifacts/visual-feedback/after/devices-modal.png) | 確認済み |
| 390×640・新規作成 | [画像](../artifacts/visual-feedback/before/project-modal.png) | 短い画面で下端の確定操作が窮屈 | フォームをスクロール可能にし、確定操作を下端へ固定 | [画像](../artifacts/visual-feedback/after/project-modal.png) | 確認済み |
| 390×844・デスクトップ未接続 | [画像](../artifacts/visual-feedback/before/desktop-modal.png) | 大量の補助操作が上部約250pxを使う | 接続先・表示・操作状態を優先、補助操作は開閉式 | [画像](../artifacts/visual-feedback/after/desktop-modal.png) | 確認済み |
| 390×844・ファイル一覧 | [画像](../artifacts/visual-feedback/before/files-modal.png) | どのデバイスのファイルか不明瞭 | デバイス名をヘッダーに明示、狭幅の一覧表示を維持 | [画像](../artifacts/visual-feedback/after/files-modal.png) | 確認済み |
| 900×700・Spark切断 | [画像](../artifacts/visual-feedback/before/offline-panel.png) | 端末内の赤文字だけでは接続状態と対処が分かりづらい | 対象パネルに未接続・自動復帰状況・再接続ボタンを表示 | [画像](../artifacts/visual-feedback/after/offline-panel.png) | 確認済み |

追加した検索一覧は旧版に対応画面がないため、ペア比較とは別に[新画面](../artifacts/visual-feedback/after/panel-overview.png)を確認。スマホからDGX Sparkを検索し、パネル3を選べる。

## 独立レビューと修正

初回の優先事項は「パネル幅に応じて操作を畳む」「入力先を明確にする」「スマホでも全パネルへ到達できる入口を用意する」。3点とも実装。

実装後の再批評では、タブの閉じるボタンに親のキー処理が干渉する問題、選択タブの視覚識別、分割境界を狭めた後の復帰手段、タブレットでのタッチ領域、ダイアログ中のショートカット、タブ移動先の番号を指摘。6点を修正し、再レビューで重大な残存問題なしとの確認を得た。追加のpointercancel対策も適用。

## 検証

- Web既存テスト15件・サーバー既存テスト38件が合格。TypeScript型検査・本番ビルド・git diff --checkも合格。
- ブラウザ12ケースで未処理例外とページ横はみ出しを検査。
- スマホの一覧からSparkへ切替え、1920pxへ拡大して元の4分割へ戻ることを確認。端末WebSocketの接続回数と保存済み分割ツリーが変わらないことを検査。
- タブの矢印キー移動後もDOMフォーカスを維持。閉じるボタンのEnter、メニューのEnd/Escape、仮想デスクトップ改名ダイアログの入力・Enter確定を検査。
- 分割境界を180pxまで動かして自動集中表示に入り、画面幅を変えず「戻す」で4分割を復旧。
- ダイアログ中のAlt+Enterが背後を変更しないこと、900pxのtouch contextで主要ツールバーとタブの閉じる操作が44px以上であることを検査。
- 未接続パネルの手動再接続で当該端末が接続を試行することを検査。最終操作検証でxtermの透明canvasが再接続ボタンを覆う問題を発見し、端末の重なり順をパネル内に閉じて修正。

ブラウザ確認の端末とデスクトップ未接続状態は合成データであり、実機のIME・OSキーボード・RFB画質を再検証したものではない。今回RFB転送や認証方式は変更していない。

## 再実行

ChromiumとPlaywrightを利用可能な環境で：

```bash
npm run build
# Playwrightをプロジェクト外に導入した場合のみ、そのモジュールのパスを指定する。
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node web/test/visual-feedback.cjs after
# Before用のビルドを別途用意した場合：
STATIC_ROOT=/path/to/baseline/web/dist PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node web/test/visual-feedback.cjs before
```

画像と計測値は `artifacts/visual-feedback/{before,after}/` に保存する。

## 右クリックの分割操作の整理

端末の右クリックからtmux内部の分割・ズーム・ペイン終了・ウィンドウ終了を除き、コピー・貼り付け・ブラウザのタブ／パネル操作に限定した。画面分割は「新しい端末を右／下に並べる」と明示。Shift＋右クリックのブラウザメニューを許可するときも、右ボタンの押下・解放はtmuxへ渡さない。

[整理後の右クリックメニュー](../artifacts/visual-feedback/after/terminal-context-menu.png)を目視確認。マウス追跡を有効にした合成端末で、通常／Shift＋右クリックが端末入力を送らないことと、tmux内部の構造変更項目が存在しないことをブラウザで検査。型検査と本番ビルドも合格。

## Tokyo Night と選択時のサイズ固定

UI・端末・PWAの背景をTokyo Nightのnight配色へ統一。[配色の参照元](https://github.com/folke/tokyonight.nvim/blob/main/extras/kitty/tokyonight_night.conf)に沿って背景 `#1a1b26`、文字 `#c0caf5`、青 `#7aa2f7` などを使用。端末のbright色は通常色と揃え、蛍光色の強調を抑えた。デバイスを切り替えても配色を上書きせず、状態表示の発光・点滅も除いた。After画像はこの配色で更新。

選択中パネルだけ枠幅が1pxから2pxになる指定を廃止し、常に1pxで色だけ切り替える。タブ名のフォントウェイトも選択前後で一定にした。ブラウザ検証で、別パネル選択前後の本文矩形・ヘッダー幅・端末canvas寸法が完全に一致すること、およびタブ選択前後に全タブの幅が一致することを確認。デバイス切替後もTokyo Nightのアクセント色を維持することを検査。12画面の確認、型検査、本番ビルド、サーバーテスト38件も合格。
