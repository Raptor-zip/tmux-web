# タブのタッチ領域の見直し

2026-10-29。既存の合成データfixtureを使用。日本語・Tokyo Night・900×1024・deviceScaleFactor=1・タッチ入力・reduced motionを固定し、Tailscaleや実際のtmuxへは接続していない。

| Screen | Before | Finding | Change | After | Result |
| --- | --- | --- | --- | --- | --- |
| タブレット・2パネル | [Before](../artifacts/visual-feedback/touch-controls/before/tablet-two.png) | タブを閉じる操作とタブ操作メニューが32px幅。既存の44pxルールを末尾のCSSが上書きしていた | タッチ端末は44×44pxへ戻す。選択中タブは幅変更後も先頭を見せる | [After](../artifacts/visual-feedback/touch-controls/after/tablet-two.png) | 1枚ずつ目視確認。1行のタブ列・デバイス表示・ページ幅を維持。長い名前は省略し、詳細はタブの一覧・メニューで確認できる |

モバイル390×844からタブレット900×1024へ変更し、閉じる・タブ操作・パネル操作の各ボタンが44px以上であることを確認した。保存した分割配置は変わらず、実行時エラーとページの横はみ出しもなかった。

再現コマンド（PlaywrightとChromiumのパスは環境に合わせる）:

```bash
npm run build
SCREENS=tablet-two TEST_OUTPUT=/tmp/tmux-web-touch-review/after \
  PLAYWRIGHT_MODULE=/path/to/playwright node web/test/visual-feedback.cjs after
ATTACHMENT_CHECK=1 SCREENS=mobile-panels TEST_OUTPUT=/tmp/tmux-web-touch-review/after \
  PLAYWRIGHT_MODULE=/path/to/playwright node web/test/visual-feedback.cjs after
```

併せて添付のシェル引用・タブ切替・途中失敗のブラウザ検証、サーバ43テスト、Web20テスト、TypeScript、production buildが通過した。
