---
date: 2026-10-30 03:42:07
phase: "プロジェクト入力開始の確認"
iteration: 15
status: success
---

## やろうとしたこと

プロジェクトを開いた直後の入力先を修正し、キーボード操作と狭い画面を確認する。

## 実際に起きたこと

Chromium・WebKit、それぞれ1280×800と390×640で次を確認した。

- 新規作成を開いた直後に INPUT がフォーカスされ、クリックせず focus-check と入力できる。
- 既存フォルダーへ切り替えるとパス入力欄がフォーカスされ、/home/demo に /probe を追記できる。
- 新規作成に戻ると名前がフォーカスされ、focus-check が保持される。
- サイドバーから直接「フォルダーを開く」を選んでも、最初からパスへ入力できる。
- どちらのモードも Escape で閉じられる。実行時エラーとページの横はみ出しはない。

同一の合成データ・時刻・Tokyo Night・日本語・reduced motion・1280×800で取得した画像を1枚ずつ確認した。

| Screen | Before | Finding | Change | After | Result |
| --- | --- | --- | --- | --- | --- |
| プロジェクト作成・PC | [修正前](../../artifacts/visual-feedback/project-focus/before/project-desktop.png) | 入力欄が未選択で、最初のタイプが届かない | dialog を開いた後に対象入力欄をフォーカス | [修正後](../../artifacts/visual-feedback/project-focus/after/project-desktop.png) | 名前欄のフォーカス表示と直後の入力を確認 |

390×640の修正後画像も個別に確認し、入力欄・ツール・下書き・作成ボタンが収まることを確認した。実機スマートフォンのソフトウェアキーボード表示は今回測定していない。

## 原因

[原因記録](2026-10-30-39-project-initial-focus-cause.md) のとおり、autoFocus が閉じた dialog に対して実行されていた。

## 試して却下した方法

固定時間の setTimeout や共有 Modal 全体の変更は不要。このフォームの入力欄だけを、子 Modal の effect 後に選択する。

## 最終的な対応

ProjectStart の名前とパスへ ref を渡し、mode に依存する effect でフォーカスする。診断用の一時 fixture 追記は削除し、恒久テストは追加していない。TypeScript と本番ビルドが成功し、配信する JavaScript は index-B1kklwxj.js になった。

実サービスは再起動なしで新しい静的ファイルを配信する。匿名 API 401、認証済み API 200、実状態の WebSocket 2フレームと refresh を再確認した。バックエンドとユーザーの tmux セッションは変更していない。

## 次にやる人が知っておくべきこと

手動診断の詳細は /tmp/tmux-web-focus-{before,after}-{chromium,webkit}.log。候補ビルドは /tmp/tmux-web-focus-dist、本番ビルド結果は /tmp/tmux-web-focus-production-build.log。既存の500KBチャンク警告は残るが、今回のビルド失敗ではない。以降は04:00 JSTの最終監査を進める。
