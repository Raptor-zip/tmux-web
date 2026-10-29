---
date: 2026-10-29 23:38:35
phase: "添付の改善"
iteration: 1
status: success
---

## やろうとしたこと

別デバイスへの添付中継、パスの引用、送信中のタブ変更、複数ファイルの途中失敗、切断時の下書き保持を改善した。`attachments.ts` でパス引用と結果の型を共有し、TerminalHandle.pasteは実際に入力できたかを返すようにした。

## 実際に起きたこと

Web単体テスト20件、TypeScript、production build、サーバ全体43件が通過。新しいブラウザ検証では特殊文字を含むパスがそのまま届き、送信中に同じパネルのタブを変更すると端末入力を発生させず下書きへ回収できた。2件目が失敗した場合も1件目のパスと既存下書きを保持し、後から手動挿入できた。390×844の画面を1枚ずつ確認し、横はみ出しと実行時エラーはなかった。

既存の画面fixtureでは、以前のUI名・クラスを参照する追加検証が失敗した。

```text
locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'タブ・パネルの一覧を開く', exact: true })

    at /home/somak/tmux-web/web/test/visual-feedback.cjs:115:68 {
  log: [
    "  - waiting for getByRole('button', { name: 'タブ・パネルの一覧を開く', exact: true })"
  ],
  name: 'TimeoutError'
}
```

更新後、さらに旧クラス参照を確認した。

```text
locator.textContent: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('.toolbar-device')

    at /home/somak/tmux-web/web/test/visual-feedback.cjs:121:55 {
  log: [ "  - waiting for locator('.toolbar-device')" ],
  name: 'TimeoutError'
}
```

タブ件数ボタンと選択中のタブIDを使う検証に更新した。スクロールテストは全体では成功したが、反復実行で同じ155行目の待ち失敗が再現しているため、次の改善単位で調べる。

## 原因

詳細は2026-10-29-02を参照。画面fixtureの追加失敗は、直近のコンパクトなタブ列への変更が反映されていないことが原因。添付の回帰検証は成功していた。

## 試して却下した方法

なし。

## 最終的な対応

中継の許可経路を必要な2本だけ追加。POSIXシェルの引用を実際の/bin/shで往復検証。添付開始時のsession/windowと完了時の端末を照合し、入力できなければ下書きへ保持する。画像貼り付けでも入力先・接続の変化を確認する。READMEへ復旧時の操作を追記した。

## 次にやる人が知っておくべきこと

ブラウザ検証は `ATTACHMENT_CHECK=1 SCREENS=mobile-panels TEST_OUTPUT=/tmp/tmux-web-overnight-attachments PLAYWRIGHT_MODULE=/tmp/dcon-odor-cad-env/lib/python3.12/site-packages/playwright/driver/package node web/test/visual-feedback.cjs after`。実ファイル・実端末へは接続しない。画像は/tmpに保存し、生成物をGitへ追加しない。
