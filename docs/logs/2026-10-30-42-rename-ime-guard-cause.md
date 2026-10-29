---
date: 2026-10-30 03:48:25
phase: "名称入力のIME確認"
iteration: 17
status: partial
---

## やろうとしたこと

最終監査で見つけた名称入力のIMEガード漏れを、実データへ触れず再現する。

## 実際に起きたこと

合成APIで名称変更の要求数を記録した。サイドバーでは isComposing=true のEnterが名称変更を1回送信し、Escapeは編集中の欄を閉じた。keyCode=229でも同じ結果になった。共通の名前変更ダイアログでは isComposing=true は守られていたが、keyCode=229のEnterが1回送信された。

```text
rename IME probe {"inline":[{"key":"Enter","keyCode":13,"isComposing":true,"remains":false,"actions":1},{"key":"Escape","keyCode":27,"isComposing":true,"remains":false,"actions":0},{"key":"Enter","keyCode":229,"isComposing":false,"remains":false,"actions":1},{"key":"Escape","keyCode":229,"isComposing":false,"remains":false,"actions":0}],"dialog":[{"keyCode":13,"isComposing":true,"remains":true,"actions":0},{"keyCode":229,"isComposing":false,"remains":false,"actions":1}]}
desktop-controls {"overflow":false,"visiblePanels":[{"width":1020,"headerWidth":920}],"dialogs":[]}

```

最初の診断では、ホバー時のみ表示される行ツールをホバーせず探したため、fixtureがタイムアウトした。アプリ操作の入口に合わせて、対象のウィンドウ行をホバーしてから名前変更を選ぶと再現できた。

```text
locator.click: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for getByRole('button', { name: '名前を変更', exact: true }).first()[22m

    at /home/somak/tmux-web/web/test/visual-feedback.cjs:104:70 {
  log: [
    "  - waiting for getByRole('button', { name: '名前を変更', exact: true }).first()"
  ],
  name: 'TimeoutError'
}

```

## 原因

Sidebarのインライン名称変更はEnterとEscapeを無条件で処理していた。DialogはisComposingだけを確認しており、既にSwitcherとTerminalで扱っているkeyCode=229の経路が抜けていた。

## 試して却下した方法

実機でIMEの全動作を検証したという扱いにはしない。今回の証拠は、ブラウザーで送る合成KeyboardEventに対する編集欄とAPI送信の結果である。

## 最終的な対応

名称入力のキー処理を、既存Switcherと同じisComposingまたはkeyCode=229で保護する。通常Enterでは名称変更が一度だけ送信されることもChromiumとWebKitで確認する。

## 次にやる人が知っておくべきこと

実際のtmuxに名称変更やコマンドを送っていない。変更前の合成ブラウザー結果は /tmp/tmux-web-rename-ime-before-2.log。ここまでを原因記録として保存した後に修正する。
