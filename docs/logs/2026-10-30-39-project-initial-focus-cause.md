---
date: 2026-10-30 03:39:51
phase: "初回フォーカスの原因記録"
iteration: 15
status: partial
---

## やろうとしたこと

プロジェクト作成画面を開いた直後に、クリックを追加せず名前を入力できることを確認する。

## 実際に起きたこと

Chromium と WebKit の両方で、1280×800 と390×640の画面を調べた。初回の document.activeElement は「閉じる」BUTTON で、focus-check をタイプしてもプロジェクト名は空のままだった。既存フォルダーへ切り替えた後は INPUT が選択され /probe を追加できた。新規作成に戻った後も INPUT は選択されたが、最初の入力自体は届いていない。

関連ログを読む補助コマンドで、ファイル名を誤記した。rg --files で実際の名称 operation-docs-verified を確認した。

```text
sed: can't read docs/logs/2026-10-30-37-operation-guides-verified.md: No such file or directory
```

## 原因

React の autoFocus は要素マウント時に実行される。一方、親として描画される Modal の dialog はマウント後の useEffect で showModal される。まだ閉じている dialog 内へのフォーカス指定は初回入力を選択できず、その後 showModal が先頭の閉じるボタンを選択する。モード切り替えでは dialog が開いているため autoFocus が働いていた。

## 試して却下した方法

共有 Modal の最初のボタンを変更すること。閉じる操作や他のダイアログに影響が広がるため、このフォーム内で対象の入力欄を指定する。

## 最終的な対応

ProjectStart の名前・パス入力欄に共通の ref を渡し、Modal が開いた後の effect でフォーカスする。モード変更時も対象欄を選ぶ。両ブラウザー・両画面サイズで初回入力と入力内容の保持を再確認する。

## 次にやる人が知っておくべきこと

診断記録は /tmp/tmux-web-focus-before-{chromium,webkit}.log。実プロジェクト作成や実端末への入力は一切していない。ここまでを原因記録として保存した後にソースを変更する。
