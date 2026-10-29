---
date: 2026-10-30 01:34:13
phase: "ファイルAPI"
iteration: 7
status: success
---

## やろうとしたこと

空ファイルの添付、長い日本語ファイル名、画像のContent-Type、ドットで始まる作業フォルダーの保存を修正し、稼働サービスへ反映する。

## 実際に起きたこと

- 再現した4件の失敗全文は [開始・原因ログ](2026-10-30-10-file-api-edge-cases-start.md) に記録済み。
- ファイルAPIの8件を含むサーバー全59件が成功。テスト用保存先を注入し、ユーザーの添付用一時フォルダーに触れず確認した。
- 同名の長い日本語名を2回保存し、UTF-8を分断せず、拡張子を残し、内容を上書きしないことを実ファイルで確認した。
- `.project/public/manual-logo.svg` をアーカイブから抽出して内容一致を確認。隠し子要素・node_modules・__pycache__は除外された。
- サービス再起動完了後、PID 1310538、active/running。匿名の認証APIは401、本人の認証APIは200。イベントWebSocketは初期状態と明示更新の2フレームを受信した。

最初の稼働確認スクリプトはnpm workspaceの依存がルートに配置されることを見落として失敗した。検査スクリプトのimportを `import { WebSocket } from 'ws'` に直し、再実行は成功した。アプリ側の変更は不要。

```text
node:internal/modules/cjs/loader:1421
  const err = new Error(message);
              ^

Error: Cannot find module './server/node_modules/ws'
Require stack:
- /home/somak/tmux-web/[eval1]
    at Module._resolveFilename (node:internal/modules/cjs/loader:1421:15)
    at defaultResolveImpl (node:internal/modules/cjs/loader:1059:19)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1064:22)
    at Module._load (node:internal/modules/cjs/loader:1227:37)
    at TracingChannel.traceSync (node:diagnostics_channel:328:14)
    at wrapModuleLoad (node:internal/modules/cjs/loader:245:24)
    at Module.require (node:internal/modules/cjs/loader:1504:12)
    at require (node:internal/modules/helpers:152:16)
    at file:///home/somak/tmux-web/[eval1]:7:23
    at ModuleJob.run (node:internal/modules/esm/module_job:413:25) {
  code: 'MODULE_NOT_FOUND',
  requireStack: [ '/home/somak/tmux-web/[eval1]' ]
}

Node.js v24.13.0
```

## 原因

空画像と通常ファイルの検証が同じだった。名前の文字数制限はファイルシステムのバイト数制限と一致しなかった。MIME値を正規化せず比較していた。tarの `--exclude=.*` は選択したルート自体にも一致した。

## 試して却下した方法

なし。再現前に使ったos.tmpdirのモックは取り除き、正式なpasteDir注入だけで各テストを隔離した。

## 最終的な対応

ファイル名をコードポイントごとにUTF-8のバイト上限へ収め、短い拡張子と衝突時の連番を確保した。通常ファイルは0バイトを許可し、画像の空データ拒否は維持した。画像MIMEは小文字化する。アーカイブの除外を子要素のパターンへ変更し、手作業の入力素材を保持した。READMEへ保存時の名前調整と0バイト対応を追記した。

## 次にやる人が知っておくべきこと

フロントエンドのコードはこの区切りでは変更していない。稼働バックエンドは反映済み。ファイルAPIの保存先は本番では従来どおりOS一時フォルダー内で、テストだけ独立した一時ディレクトリを指定する。引き続き04:00 JSTまで改善を継続する。
