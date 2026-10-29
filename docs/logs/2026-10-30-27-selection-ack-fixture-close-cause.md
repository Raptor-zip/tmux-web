---
date: 2026-10-30 02:31:53
phase: "切替完了確認"
iteration: 11
status: partial
---

## やろうとしたこと

選択応答の欠落から10秒で再接続する検査を実行する。

## 実際に起きたこと

最初のブラウザー検査は、Reactの描画完了を待たずにdisabledを読んでいた。待つようにすると下書き保持と古い応答の条件は成功し、再接続だけが失敗した。

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

+ [
+   'attachments wait for the current selection to finish',
+   'draft insertion waits for the current selection to finish',
+   'a missing acknowledgement times out and reconnects'
+ ]
- []

    at checkTerminalSelection (/home/somak/tmux-web/web/test/terminal-selection.cjs:61:10)
    at async /home/somak/tmux-web/web/test/visual-feedback.cjs:90:81 {
  generatedMessage: true,
  code: 'ERR_ASSERTION',
  actual: [Array],
  expected: [],
  operator: 'deepStrictEqual',
  diff: 'simple'
}

```

時計を進めた検査、および実際に10秒以上待った検査は、それぞれ以下で止まった。

```text
AssertionError [ERR_ASSERTION]: selection acknowledgement fixture did not receive its expected request
    at waitFor (/home/somak/tmux-web/web/test/terminal-selection.cjs:12:12)
    at async checkTerminalSelection (/home/somak/tmux-web/web/test/terminal-selection.cjs:55:3)
    at async /home/somak/tmux-web/web/test/visual-feedback.cjs:90:81 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: undefined,
  expected: undefined,
  operator: 'fail',
  diff: 'simple'
}

```

```text
AssertionError [ERR_ASSERTION]: selection acknowledgement fixture did not receive its expected request
    at waitFor (/home/somak/tmux-web/web/test/terminal-selection.cjs:12:12)
    at async checkTerminalSelection (/home/somak/tmux-web/web/test/terminal-selection.cjs:53:3)
    at async /home/somak/tmux-web/web/test/visual-feedback.cjs:90:81 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: undefined,
  expected: undefined,
  operator: 'fail',
  diff: 'simple'
}

```

インストール済みPlaywrightのtypes/types.d.tsに、onCloseハンドラーを設定すると既定の切断伝達が無効になり、ハンドラーが引き受ける必要があると明記されていた。fixtureのonCloseはカウントを減らすだけで、切断を返していなかった。

途中の型検査は次で失敗した。useRefの戻り型をbooleanと明示して解消し、以降のTypeScript検査は成功している。

```text
web/src/components/Terminal.tsx(144,31): error TS2322: Type 'boolean' is not assignable to type 'false'.
```

初めにPlaywrightの旧ファイル配置を推測して読もうとした際のエラー。続けてrg --filesと実在するtypes/types.d.tsで確認した。

```text
rg: /tmp/dcon-odor-cad-env/lib/python3.12/site-packages/playwright/driver/package/lib/client/network.js: No such file or directory (os error 2)
sed: can't read /tmp/dcon-odor-cad-env/lib/python3.12/site-packages/playwright/driver/package/lib/client/network.js: No such file or directory
```

## 原因

テストのモックが切断ハンドシェイクを止めていた。実サーバーのwsは閉じる処理へ応答するが、fixtureではその既定動作をonCloseで上書きしていた。

## 試して却下した方法

アプリへ追加の再接続処理を重ねる方法は採らない。まずfixtureを実WebSocketの切断動作に合わせる。時計差による誤判定を避け、今回の期限検査は実時間で行う。

## 最終的な対応

これからonCloseでカウントを減らした後、closeを返す。ブラウザーの描画と新しい接続イベントを待ってから状態を評価する。切り替え待ちの表示は接続エラーと区別する。

## 次にやる人が知っておくべきこと

アプリのサーバー68件、Web40件、TypeScriptはこの時点で成功している。再接続の最終判定はfixture修正後に行う。
