import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { quotePath } from '../src/attachments';

test('attachment paths round-trip as literal shell arguments, including quotes and shell syntax', () => {
  const paths = [
    '/tmp/simple-file.png', '/tmp/日本語 image.png', "/tmp/it's a file.txt",
    '/tmp/$(printf expanded);&|<>`printf expanded`$HOME.txt',
    '/tmp/line\nbreak\tfile.txt', '/tmp/back\\slash"file.txt', '',
  ];
  const result = execFileSync('/bin/sh', ['-c', `printf '%s\\0' ${paths.map(quotePath).join(' ')}`]);
  assert.deepEqual(result.toString().split('\0'), [...paths, '']);
});
