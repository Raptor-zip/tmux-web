---
date: 2026-10-30 01:24:44
phase: "ファイルAPI"
iteration: 7
status: partial
---

## やろうとしたこと

空ファイル、長い日本語名、MIMEの大文字小文字、ドットから始まる作業ルートの一括保存をHTTP経由で検証した。テスト用の保存先は/tmpの専用ディレクトリに閉じ込め、既存の添付ファイルは触らない。

## 実際に起きたこと

`getconf NAME_MAX /tmp` は255を返した。修正前は新しい4件が失敗した。

```text
✔ authenticated listing, navigation, missing panes and confined paths (54.64302ms)
✔ scoped media URLs, Unicode download names, HEAD and byte ranges (27.595846ms)
✔ invalid, tampered and expired links, and symlink replacement after issuance (7.326304ms)
✔ native uploads avoid overwrites and folder downloads preserve input assets while excluding secrets (25.237953ms)
✖ empty regular files can be uploaded and attached without accepting an empty image (7.836183ms)
✖ long Unicode names fit the filesystem, retain extensions and never overwrite an earlier upload (6.118138ms)
✖ image content types are case insensitive and attachments use private files (3.648005ms)
✖ a dot-prefixed project root still archives manual assets and excludes hidden descendants (11.091841ms)
ℹ tests 8
ℹ suites 0
ℹ pass 4
ℹ fail 4
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 260.203228

✖ failing tests:

test at server/test/files.test.js:131:1
✖ empty regular files can be uploaded and attached without accepting an empty image (7.836183ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  400 !== 200
  
      at TestContext.<anonymous> (file:///home/somak/tmux-web/server/test/files.test.js:141:10)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 400,
    expected: 200,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at server/test/files.test.js:151:1
✖ long Unicode names fit the filesystem, retain extensions and never overwrite an earlier upload (6.118138ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  500 !== 200
  
      at TestContext.<anonymous> (file:///home/somak/tmux-web/server/test/files.test.js:158:47)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 500,
    expected: 200,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at server/test/files.test.js:176:1
✖ image content types are case insensitive and attachments use private files (3.648005ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  415 !== 200
  
      at TestContext.<anonymous> (file:///home/somak/tmux-web/server/test/files.test.js:180:10)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 415,
    expected: 200,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at server/test/files.test.js:189:1
✖ a dot-prefixed project root still archives manual assets and excludes hidden descendants (11.091841ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /\.project\/public\/manual-logo\.svg/. Input:
  
  ''
  
      at TestContext.<anonymous> (file:///home/somak/tmux-web/server/test/files.test.js:204:10)
      at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: '',
    expected: /\.project\/public\/manual-logo\.svg/,
    operator: 'match',
    diff: 'simple'
  }
```

## 原因

空の通常アップロードは既に受け付けていたが、添付ではBufferの長さ0を拒否していた。名前の制限が文字数のため、UTF-8で長い日本語が保存先の上限を超える。画像MIMEの照合が大文字小文字を区別する。tarの--exclude=.*がドットから始まる作業ルート自体も除外し、空のアーカイブを返す。

## 試して却下した方法

なし。Rangeの大きなsuffix数値はファイル全体へ丸める現在の挙動を変更する根拠がないため、今回は変更しない。

## 最終的な対応

空の通常ファイルを添付できるようにし、空画像の拒否は維持する。UTF-8のバイト数と拡張子を考慮して保存名を調整し、重複時も上書きしない。画像MIMEを正規化する。tarは作業ルートを残し、隠しファイルなどの子孫だけを除外する。

## 次にやる人が知っておくべきこと

開始と原因特定を兼ねる。添付保存先はテスト用に注入し、旧実装の再現時もos.tmpdirをテスト内だけで差し替えている。実ファイルへは送信しない。HEADは810a83e、期限は04:00 JST。
