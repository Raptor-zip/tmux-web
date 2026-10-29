---
date: 2026-10-30 02:15:13
phase: "入力先検証"
iteration: 10
status: success
---

## やろうとしたこと

入力先検証の実装・テスト・再現ログをまとめてコミットする前に差分を確認する。

## 実際に起きたこと

staged差分の検査は、再現時のAssertionErrorをそのまま記録したコードブロック内の空白行4箇所だけを指摘した。コミットはまだ実行されていない。

```text
docs/logs/2026-10-30-21-terminal-window-target-cause.md:66: trailing whitespace.
+  
docs/logs/2026-10-30-21-terminal-window-target-cause.md:70: trailing whitespace.
+  
docs/logs/2026-10-30-22-terminal-window-identity-cause.md:81: trailing whitespace.
+  
docs/logs/2026-10-30-22-terminal-window-identity-cause.md:85: trailing whitespace.
+  
```

上の空白はこのログでも元の出力を保持している。ログを除いたstaged差分の `git diff --cached --check -- . ':!docs/logs/**'` は成功した。

## 原因

Nodeのテスト失敗出力にはスペースだけの区切り行がある。失敗全文を保存したためで、ソースコードの行末空白ではない。

## 試して却下した方法

保存済みの原因ログから診断出力を整形して削ること、リポジトリ全体の空白検査を無効化することはしない。

## 最終的な対応

診断出力を保持し、コードとドキュメント本文の検査成功を別に確認した。同じ差分を意味のある単位でコミット・プッシュする。

## 次にやる人が知っておくべきこと

アプリの最終検証と稼働反映は [検証ログ](2026-10-30-23-terminal-window-target-verified.md) に記録済み。行末空白は引用した診断出力に限る。
