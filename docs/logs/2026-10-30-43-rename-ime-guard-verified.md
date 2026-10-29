---
date: 2026-10-30 03:51:18
phase: "名称入力のIME確認"
iteration: 17
status: success
---

## やろうとしたこと

変換中のキーで名称変更を確定・中断しないようにし、通常の確定操作を維持する。

## 実際に起きたこと

候補ビルドを使い、ChromiumとWebKitの両方で合成KeyboardEventを確認した。

- インライン編集では、isComposing=trueのEnter・Escapeと、keyCode=229のEnter・Escapeの4経路すべてで編集欄が残り、API要求は0回。
- 名前変更ダイアログでは、isComposing=trueのEnterとkeyCode=229のEnterの2経路とも入力欄が残り、API要求は0回。
- 続けて通常のEnterを押すと、インライン編集もダイアログも閉じ、名称変更のAPI要求がそれぞれ1回だけ送られる。
- 実行時エラーとページの横はみ出しはない。

TypeScript、フロントエンド40テスト、候補ビルドと本番ビルドが成功した。

## 原因

[原因記録](2026-10-30-42-rename-ime-guard-cause.md) のとおり、Sidebarで変換状態を見ておらず、DialogではkeyCode=229の保護が不足していた。

## 試して却下した方法

フォーム全体のキー処理を書き換えることや、固定時間でIMEを推測すること。既存Switcherと同じキー情報の判定で修正できた。

## 最終的な対応

SidebarとDialogの対象ハンドラーでisComposingまたはkeyCode=229なら処理を戻す。通常のEnter・Escapeの処理は維持した。診断用fixture追記は削除し、実装をなぞる恒久テストは追加していない。本番のJavaScriptはindex-ovMmF_z2.jsとなった。

## 次にやる人が知っておくべきこと

結果は /tmp/tmux-web-rename-ime-after-{chromium,webkit}.log。APIはすべて合成応答で、実際のtmuxへの名称変更はしていない。OSの実IME候補ウィンドウ自体を操作した検証ではない。最終監査は継続中で、期限は04:00 JST。
