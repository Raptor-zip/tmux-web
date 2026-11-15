# 端末の WebGL 描画

PWA（Chrome）で端末の出力が多いと重い、という問題への対応。GPUI などでネイティブに
作り直す前に、ブラウザ内で一番効く箇所を計測して直した。

## 計測（DOM 描画 vs WebGL 描画）

1920×1080 に端末 4 枚（各 56〜59 列 × 67 行）を並べ、2 種類の負荷をかけた。各 3 回。
生データ: `artifacts/performance/terminal-renderer/results.json`

| 環境 | 描画 | 大量出力（150 チャンク×4 端末） | TUI 再描画 60fps 供給 3 秒：描けたフレーム | p95 フレーム間隔 |
|---|---|---|---|---|
| 実 GPU（GB10） | DOM | 6.2〜8.7 秒（長いタスク 1.6〜4.3 秒） | 43〜72 | 183〜233ms |
| 実 GPU（GB10） | WebGL | 3.2〜5.4 秒（長いタスク 0.08〜0.3 秒） | 154〜164 | 17〜33ms |
| SwiftShader | DOM | 2.8〜11.5 秒 | 53〜100 | 67〜217ms |
| SwiftShader | WebGL | 59〜87 秒 | 5 | 約 1.5 秒 |

- ハードウェア GPU があれば WebGL は TUI の再描画で約 3 倍のフレームを描き、メインスレッドの
  ブロックは 1/6〜1/10 になる。
- ソフトウェア GL では WebGL が DOM の 10 倍以上遅い。自動判定でこの環境を必ず避ける必要がある。

再現:

```bash
npx vite build --config scripts/benchmark-terminal-renderer/vite.config.mjs
PLAYWRIGHT_MODULE=/path/to/playwright CHROME_BIN=/path/to/chrome \
  node scripts/benchmark-terminal-renderer/run.cjs
```

## 方針

- `web/src/terminal-renderer.ts`: `failIfMajorPerformanceCaveat` と `WEBGL_debug_renderer_info` で
  ハードウェア GPU を判定し、ソフトウェア GL（SwiftShader / llvmpipe など）では DOM のまま。
  `localStorage['tw.renderer']` に `"webgl"` / `"dom"` を入れると上書きできる。
- WebGL アドオン（約 100KB）は別チャンクにし、使う環境でだけ読み込む。
- WebGL を持つのは「表示中の端末」かつ「表示中のページ」だけ。隠れたら `WEBGL_lose_context` で
  コンテキストを明示的に手放す（`dispose()` だけでは GC まで残り、ブラウザの上限 16 個に数えられて
  表示中の端末のコンテキストが奪われる）。
- 以前 DOM 描画に固定していた理由（スリープ復帰で canvas のコンテキストを失う）は、裏に回ったら
  手放し、戻ったら作り直すことで避ける。表示中に失われた場合は DOM 描画に戻し、
  3 回失った端末は DOM に固定する。
- 描画方式を切り替えるときは測り直さない。DOM と WebGL で文字の寸法がわずかに違うため、
  測り直すと裏に回るたびに列数が変わり、tmux のリサイズが往復する。

## 確認

```bash
npm test -w web
# 実 GPU で自動判定 → WebGL、タブ切り替え・バックグラウンドでの解放、リサイズが出ないこと、
# コンテキスト喪失からの DOM 復帰と入力
CHROME_ARGS="--enable-gpu --use-angle=gl-egl" TERMINAL_WEBGL_CHECK=1 NO_SCREENSHOTS=1 \
  SCREENS=many-tabs,desktop-four,mobile-panels PLAYWRIGHT_MODULE=/path/to/playwright \
  node web/test/visual-feedback.cjs check
# ソフトウェア GL では DOM のまま（既存の復帰テスト）
TERMINAL_WAKE_CHECK=1 NO_SCREENSHOTS=1 SCREENS=many-tabs PLAYWRIGHT_MODULE=/path/to/playwright \
  node web/test/visual-feedback.cjs check
```

`terminal-target` / `terminal-selection` などの既存チェックは `.xterm-rows`（DOM 描画の文字）を
読むので、GPU を有効にせず（SwiftShader = DOM 描画で）実行する。

## 今回やらなかったこと

- デスクトップ画面（noVNC）を開いている間、その裏の端末も描画を続ける。WebGL なら負荷は小さいが、
  さらに詰めるなら覆われている間の描画停止を検討する。
- `many-tabs` シーンの `after` フェーズのアサーション（デスクトップ名変更ボタン）は、今回の変更前から
  現在の UI と合わずに失敗している。
