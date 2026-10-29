---
date: 2026-10-30 03:29:22
phase: "操作説明"
iteration: 14
status: partial
---

## やろうとしたこと

READMEの説明どおりにプロジェクト作成画面などへ入れるかを合成ブラウザーで確認する。

## 実際に起きたこと

古いfixtureは存在しない「＋ プロジェクトを作る」ボタンを探して停止した。

```text
desktop-controls {"overflow":false,"visiblePanels":[{"width":1020,"headerWidth":920}],"dialogs":[]}
locator.click: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for getByRole('button', { name: '＋ プロジェクトを作る', exact: true })[22m

    at /home/somak/tmux-web/web/test/visual-feedback.cjs:122:94 {
  log: [
    "  - waiting for getByRole('button', { name: '＋ プロジェクトを作る', exact: true })"
  ],
  name: 'TimeoutError'
}

```

Sidebar.tsxでは現在、下部の「その他・検索…」を開いた中に「プロジェクトを作る」「フォルダーを開く」がある。タブ列の「⋯」にはファイル、CLI起動、接続モード等がある。アプリの入口の不具合ではなく、READMEとfixtureの経路が古かった。

## 原因

画面整理の前のラベルと配置をドキュメント・画面取得用の補助コードが保持していた。

## 試して却下した方法

古い大きなボタンを画面へ戻すことはしない。現行の入口を案内し、その操作を使って確認する。

## 最終的な対応

これからfixtureは「その他・検索…」→「プロジェクトを作る」を使う。デバイス画面の入口も、パネルの操作メニューを経由する。READMEのCLI起動・ファイル・プロジェクト・ペイン・接続モードを現行のラベルへ揃える。

## 次にやる人が知っておくべきこと

確認中にプロジェクトを作成したり、実ユーザーの端末へ命令を送ったりはしない。表示と入口だけを合成データで確認する。
