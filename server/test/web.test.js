import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import express from 'express';
import { installWeb } from '../src/web.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-web-'));
  await fs.mkdir(path.join(root, 'assets'));
  const script = Buffer.from(Array.from({ length: 600 }, (_, i) => `console.log(${i}, '圧縮と復元を確認');`).join('\n'));
  const html = Buffer.from('<!doctype html><title>fixture app</title>');
  await fs.writeFile(path.join(root, 'index.html'), html);
  await fs.writeFile(path.join(root, 'assets', 'index-abc12345.js'), script);
  await fs.writeFile(path.join(root, 'assets', 'tiny.js'), 'export default 1;');
  await fs.writeFile(path.join(root, 'assets', 'image.png'), Buffer.alloc(8000, 1));
  const app = express();
  installWeb(app, root);
  app.get('/api/private', (_req, res) => res.set('Cache-Control', 'no-store').json({ text: 'private fixture '.repeat(1000) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const request = (route = '/assets/index-abc12345.js', headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: route, method, headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
  return { request, script, html };
}

test('public JavaScript negotiates Brotli and gzip and restores exactly to the source', async t => {
  const { request, script } = await fixture(t);
  for (const [header, encoding, decode] of [['br, gzip', 'br', brotliDecompressSync], ['gzip', 'gzip', gunzipSync], ['br;q=0.2, gzip;q=1', 'gzip', gunzipSync]]) {
    const response = await request(undefined, { 'Accept-Encoding': header });
    assert.equal(response.status, 200); assert.equal(response.headers['content-encoding'], encoding);
    assert.match(response.headers['content-type'], /javascript/); assert.match(response.headers.vary, /Accept-Encoding/i);
    assert.deepEqual(decode(response.body), script); assert.ok(response.body.length < script.length);
  }
});

test('identity, absent and rejected content codings keep an ordinary usable response', async t => {
  const { request, script } = await fixture(t);
  for (const headers of [{}, { 'Accept-Encoding': '' }, { 'Accept-Encoding': 'identity' }, { 'Accept-Encoding': 'br;q=0, gzip;q=0, deflate;q=0' }]) {
    const response = await request(undefined, headers);
    assert.equal(response.status, 200); assert.equal(response.headers['content-encoding'], undefined);
    assert.deepEqual(response.body, script);
  }
});

test('range requests, tiny scripts, images and private API data avoid compression', async t => {
  const { request, script } = await fixture(t);
  const range = await request(undefined, { 'Accept-Encoding': 'br,gzip', Range: 'bytes=0-4095' });
  assert.equal(range.status, 206); assert.equal(range.headers['content-encoding'], undefined);
  assert.equal(range.headers['content-range'], `bytes 0-4095/${script.length}`); assert.deepEqual(range.body, script.subarray(0, 4096));
  for (const route of ['/assets/tiny.js', '/assets/image.png', '/api/private']) {
    const response = await request(route, { 'Accept-Encoding': 'br,gzip' });
    assert.equal(response.status, 200); assert.equal(response.headers['content-encoding'], undefined);
    if (route === '/api/private') { assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(response.headers.vary, undefined); }
  }
});

test('HEAD and conditional requests remain valid and reserved missing paths do not receive the app shell', async t => {
  const { request, script, html } = await fixture(t);
  const head = await request(undefined, { 'Accept-Encoding': 'br,gzip' }, 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.body.length, 0); assert.equal(Number(head.headers['content-length']), script.length);
  const first = await request(undefined, { 'Accept-Encoding': 'gzip' });
  const unchanged = await request(undefined, { 'Accept-Encoding': 'gzip', 'If-None-Match': first.headers.etag });
  assert.equal(unchanged.status, 304); assert.equal(unchanged.body.length, 0);
  assert.deepEqual((await request('/workspace/fixture')).body, html);
  for (const route of ['/assets/missing.js', '/api/missing', '/ws/missing', '/files/missing']) {
    const response = await request(route, { 'Accept-Encoding': 'br,gzip' });
    assert.equal(response.status, 404); assert.notDeepEqual(response.body, html);
  }
});
