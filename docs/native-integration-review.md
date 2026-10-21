# tmux-web 機能統合の再設計と画面検証

2026-10-21。旧launcherを包んだ iframe、旧HTML/JavaScript/CSS一式、Hono、専用Cookieと `/projects` の配信を撤去。
既存の React / Express / tmux ラッパーに合わせて実装し直した。

## キャプチャ条件

PC 1440×960、スマホ幅390×844、倍率1、ダークテーマ、ja-JP、reduced motion。
既存の個人ブラウザプロファイルは使用せず、ネットワーク境界に固定の架空データ（demo / notes / README.md）を与えた。
端末WebSocketも架空のプロンプトを返し、実際の会話・パス・トークンを画像に含めていない。
これは表示検証用の置き換えで、プロダクトの認証・検証処理に例外を加えていない。
比較する状態は、履歴を探す、新規作成で名前を入力する、ファイル一覧、sudo要求を確認する、の4つ。
旧画面と新画面で、それぞれ同じ操作目的へ公開UIから到達した。新実装ではナビゲーション自体が変わる。
sudoの残り秒数は実時間で変化するため、数値そのものは比較対象から除外。
スマホ幅は Chromium のviewportによる検証で、実機Safariでの検証ではない。

## 画像ごとの確認

| Screen | Before | Finding | Change | After | Result |
| --- | --- | --- | --- | --- | --- |
| history / desktop | [before](/home/somak/.local/state/tmux-web/native-qa/before/history-desktop.png) | 履歴を探すために別アプリ内のセッション画面へ移動していた。 | 通常の一覧の下に検索・再開を配置。再開後は既存タブを残して新しいタブに開く。 | [after](/home/somak/.local/state/tmux-web/native-qa/after/history-desktop.png) | 目視確認済み。はみ出し・重なりなし。 |
| history / mobile | [before](/home/somak/.local/state/tmux-web/native-qa/before/history-mobile.png) | 履歴を探すために別アプリ内のセッション画面へ移動していた。 | 通常の一覧の下に検索・再開を配置。再開後は既存タブを残して新しいタブに開く。 | [after](/home/somak/.local/state/tmux-web/native-qa/after/history-mobile.png) | 目視確認済み。はみ出し・重なりなし。 |
| create / desktop | [before](/home/somak/.local/state/tmux-web/native-qa/before/create-desktop.png) | 端末から離れ、独自のフォームとナビゲーションで作成していた。 | 共通の色・入力・ボタンを使うフォームへ置換。保存先変更は必要な時だけ表示。 | [after](/home/somak/.local/state/tmux-web/native-qa/after/create-desktop.png) | 目視確認済み。はみ出し・重なりなし。 |
| create / mobile | [before](/home/somak/.local/state/tmux-web/native-qa/before/create-mobile.png) | 端末から離れ、独自のフォームとナビゲーションで作成していた。 | 共通の色・入力・ボタンを使うフォームへ置換。保存先変更は必要な時だけ表示。 | [after](/home/somak/.local/state/tmux-web/native-qa/after/create-mobile.png) | 目視確認済み。はみ出し・重なりなし。 |
| files / desktop | [before](/home/somak/.local/state/tmux-web/native-qa/before/files-desktop.png) | プレビュー用と転送用のファイル画面が分離していた。 | 既存のプレビュー画面にアップロード・ドロップ・フォルダー保存を統合。 | [after](/home/somak/.local/state/tmux-web/native-qa/after/files-desktop.png) | 目視確認済み。はみ出し・重なりなし。 |
| files / mobile | [before](/home/somak/.local/state/tmux-web/native-qa/before/files-mobile.png) | プレビュー用と転送用のファイル画面が分離していた。 | 既存のプレビュー画面にアップロード・ドロップ・フォルダー保存を統合。 | [after](/home/somak/.local/state/tmux-web/native-qa/after/files-mobile.png) | 目視確認済み。はみ出し・重なりなし。 |
| sudo / desktop | [before](/home/somak/.local/state/tmux-web/native-qa/before/sudo-desktop.png) | 別アプリの中でもう一段シートを開く必要があった。 | 端末の通知から共通ダイアログで承認。コマンド・内容・残り時間を一か所に表示。 | [after](/home/somak/.local/state/tmux-web/native-qa/after/sudo-desktop.png) | 目視確認済み。はみ出し・重なりなし。 |
| sudo / mobile | [before](/home/somak/.local/state/tmux-web/native-qa/before/sudo-mobile.png) | 別アプリの中でもう一段シートを開く必要があった。 | 端末の通知から共通ダイアログで承認。コマンド・内容・残り時間を一か所に表示。 | [after](/home/somak/.local/state/tmux-web/native-qa/after/sudo-mobile.png) | 目視確認済み。はみ出し・重なりなし。 |

PCとスマホ幅を個別に確認した。作成フォームは保存先設定を折り畳み、スマホでも主操作が収まるよう修正。
スマホの一覧には閉じるボタンを追加。確認後に同じ状態を再キャプチャした。
ファイルプレビュー以外にiframeを使わないこと、横方向のoverflowがないこと、未処理のJavaScriptエラーがないことを自動確認。
ネイティブダイアログ内でのTab移動、Escapeでの閉鎖、パスワード入力と誤操作防止時間に応じた承認ボタンの状態も確認した。

## 振る舞いの検証

- サーバー29件、Web8件のテスト成功。TypeScript、プロダクションビルド、Python/シェル構文確認も成功。
- 別HOME・専用tmuxソケット・偽Claudeを使い、実APIで作成→タブ表示→アップロード→プレビュー→tar.gz保存→会話再開→sudo拒否を確認。
- 既存の端末を壊さずに新規セッションの反映を待てるよう、一時的な未反映セッションをタブ整理から保護。
- 同名アップロードの上書き防止、リンク経由の上書き防止、ホーム外へのアクセス拒否、アーカイブの秘密ファイル除外を検証。
- sudoの先行回答、単回受取、取り消し、期限切れ、別サイトからの要求登録と承認の拒否を検証。実際のパスワードやsudo実行は使っていない。
- 稼働環境の既存15ペインはPIDを含めて全件維持。

再キャプチャ用スクリプトと隔離した実API検証スクリプトは、画像と同じローカルのartifactディレクトリに保存してある。
