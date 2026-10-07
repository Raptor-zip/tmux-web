import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { installScreen } from '../src/screen.js';

async function fixture(t, probeError = false) {
  let spawns = 0, kills = 0, proc;
  const app = express();
  app.use('/api', (req,res,next) => req.headers.authorization === 'qa' ? next() : res.status(401).json({error:'unauthorized'}));
  const capture = installScreen(app, {
    probe: async () => { if (probeError) throw new Error('desktop unavailable'); return {display:':99',width:640,height:400,env:{}}; },
    spawnCapture: () => {
      spawns++;
      proc = new EventEmitter(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
      proc.kill = () => { kills++; proc.stdout.end(); proc.emit('close',0); return true; };
      return proc;
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  t.after(() => {capture.dispose();server.closeAllConnections();server.close();});
  const url = `http://127.0.0.1:${server.address().port}`;
  return {capture, url, get proc(){return proc;}, get spawns(){return spawns;}, get kills(){return kills;}};
}
const delay = () => new Promise(resolve => setTimeout(resolve, 20));
const jpeg = Buffer.from([0xff,0xd8,1,2,3,0xff,0xd9]);

test('screen stream requires auth, shares capture, sends complete frames, and stops with last viewer', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.url+'/api/screen/stream')).status,401);
  assert.equal(f.spawns,0);
  const status = await (await fetch(f.url+'/api/screen/status',{headers:{authorization:'qa'}})).json();
  assert.equal(status.available,true);
  assert.equal(f.spawns,0);
  const a = new AbortController(), b = new AbortController();
  const connect = signal => fetch(f.url+'/api/screen/stream', {headers:{authorization:'qa'},signal});
  const first = connect(a.signal);
  while (!f.proc) await delay();
  // 未完成フレームを送った状態で 2 人目が接続しても、双方に完全な JPEG を届ける。
  f.proc.stdout.write(jpeg.subarray(0,3));
  const second = connect(b.signal);
  while ((await f.capture.status()).viewers !== 2) await delay();
  f.proc.stdout.write(jpeg.subarray(3));
  const responses = await Promise.all([first,second]);
  assert.equal(f.spawns,1);
  for (const res of responses) {
    assert.match(res.headers.get('content-type'), /^multipart\/x-mixed-replace; boundary=tmux-screen$/);
    const {value} = await res.body.getReader().read();
    assert.ok(Buffer.from(value).includes(jpeg));
    assert.match(Buffer.from(value).toString('latin1'), /Content-Length: 7/);
  }
  a.abort();
  while ((await f.capture.status()).viewers !== 1) await delay();
  assert.equal(f.kills,0);
  b.abort();
  while ((await f.capture.status()).viewers !== 0) await delay();
  assert.equal(f.kills,1);
});

test('missing desktop returns a recoverable error without starting capture', async t => {
  const f = await fixture(t,true);
  const status = await (await fetch(f.url+'/api/screen/status',{headers:{authorization:'qa'}})).json();
  assert.equal(status.available,false);
  const res = await fetch(f.url+'/api/screen/stream',{headers:{authorization:'qa'}});
  assert.equal(res.status,503);
  assert.equal((await res.json()).error,'desktop unavailable');
  assert.equal(f.spawns,0);
});

test('encoder failure closes streams and releases the capture', async t => {
  const f = await fixture(t);
  const pending = fetch(f.url+'/api/screen/stream',{headers:{authorization:'qa'}});
  while (!f.proc) await delay();
  f.proc.emit('error',new Error('spawn failure'));
  const res = await pending;
  assert.equal(res.status,503);
  assert.match((await res.json()).error,/ffmpeg/);
  assert.equal((await f.capture.status()).streaming,false);
});
