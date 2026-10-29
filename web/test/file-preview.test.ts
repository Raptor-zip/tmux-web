import test from 'node:test';
import assert from 'node:assert/strict';
import { readTextPreview, TEXT_PREVIEW_BYTES } from '../src/file-preview';

test('text previews preserve UTF-8 across chunks and request only the first range', async t => {
  const bytes = new TextEncoder().encode('日本語\n<script>plain text</script>');
  const signal = new AbortController().signal;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal(init.signal, signal);
    assert.equal(new Headers(init.headers).get('Range'), `bytes=0-${TEXT_PREVIEW_BYTES - 1}`);
    assert.equal(init.cache, 'no-store');
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, 2)); controller.enqueue(bytes.subarray(2)); controller.close();
    } }), { status: 206, headers: { 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` } });
  });
  assert.deepEqual(await readTextPreview('/files/content?ticket=fixture', signal), { text: '日本語\n<script>plain text</script>', truncated: false });
});

test('an upstream ignoring Range cannot make the preview read an unbounded body', async t => {
  let canceled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(TEXT_PREVIEW_BYTES + 100).fill(97)); },
    cancel() { canceled = true; },
  })));
  const result = await readTextPreview('/large');
  assert.equal(result.text.length, TEXT_PREVIEW_BYTES);
  assert.equal(result.truncated, true);
  assert.equal(canceled, true);
});

test('truncated previews omit an incomplete final UTF-8 character', async t => {
  const bytes = new TextEncoder().encode('a'.repeat(TEXT_PREVIEW_BYTES - 1) + 'あ');
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes.subarray(0, TEXT_PREVIEW_BYTES), {
    status: 206, headers: { 'Content-Range': `bytes 0-${TEXT_PREVIEW_BYTES - 1}/${bytes.length}` },
  }));
  const result = await readTextPreview('/unicode');
  assert.equal(result.text.length, TEXT_PREVIEW_BYTES - 1);
  assert.equal(result.text.includes('�'), false);
  assert.equal(result.truncated, true);
});

test('empty files are displayed even when the byte range is unsatisfiable', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 416, headers: { 'Content-Range': 'bytes */0' } }));
  assert.deepEqual(await readTextPreview('/empty'), { text: '', truncated: false });
});

test('expired tickets and authentication failures remain errors the user can retry', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'リンクの期限が切れました' }), { status: 401 }));
  await assert.rejects(readTextPreview('/expired'), /リンクの期限が切れました/);
});
