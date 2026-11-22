import { auth, headers as identityHeaders, fetch } from './helpers/tailscale.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApprovals } from '../src/approvals.js';

async function fixture(t) {
  const app=express();app.use(express.json());const service=createApprovals();service.installHelpers(app);
  app.use('/api',auth().middleware);service.install(app);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{service.dispose();server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(url,body,headers={})=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(url==='/api/approvals/request'?{}:identityHeaders),...headers},body:JSON.stringify(body)});
  return {service,base,post};
}

test('local helper bypass is narrow, UI uses normal auth and browser-origin registrations are refused',async t=>{
 const {base,post}=await fixture(t);
 assert.equal((await fetch(base+'/api/approvals')).status,401);
 assert.equal((await post('/api/approvals/request',{}, {'Sec-Fetch-Site':'same-origin'})).status,403);
 assert.equal((await post('/api/approvals/request',{}, {'X-Forwarded-For':'100.64.0.1'})).status,403);
 const created=await (await post('/api/approvals/request',{cmd:'test-only'})).json();
 const view=await (await fetch(base+'/api/approvals',{headers:identityHeaders})).json();
 assert.equal(view.pending.cmd,'test-only');assert.equal(view.pending.claim,undefined);
 assert.equal((await post('/api/approvals/answer',{id:created.id,password:'dummy'},{'Sec-Fetch-Site':'cross-site'})).status,403);
 assert.equal((await post('/api/approvals/answer',{id:created.id,password:'dummy'},{'Origin':'https://attacker.example'})).status,403);
});

test('answers may precede helper polling, claims are single use and cancellation unblocks waiters',async t=>{
 const {service,base,post}=await fixture(t);
 const created=service.create({cmd:'test'});
 assert.equal(service.answer(created.id,'dummy-test'),true);
 const received=await fetch(`${base}/api/approvals/wait?id=${created.id}&claim=${created.claim}`);
 assert.equal(await received.text(),'dummy-test');assert.equal(service.view(),null);
 assert.equal((await fetch(`${base}/api/approvals/wait?id=${created.id}&claim=${created.claim}`)).status,404);
 const next=service.create({cmd:'test'});const wait=service.claim(next.id,next.claim);
 assert.equal(service.claim(next.id,next.claim),null);
 assert.equal((await post('/api/approvals/cancel',{id:next.id})).status,200);assert.equal(await wait,null);
});

test('expired approval requests erase pending state and release the helper',async()=>{
 const service=createApprovals({ttl:20});const created=service.create({cmd:'expiry'});const wait=service.claim(created.id,created.claim);
 await new Promise(r=>setTimeout(r,30));assert.equal(await wait,null);assert.equal(service.view(),null);service.dispose();
});

test('a new request cannot replace a pending approval or cancel a password already submitted', async t => {
  const { base, post } = await fixture(t);
  const request = body => post('/api/approvals/request', body);
  assert.equal((await request({ cmd: 'echo ' + 'x'.repeat(4000) })).status, 400);
  const created = await (await request({ cmd: 'echo first', cwd: '/tmp', detail: 'script preview' })).json();
  assert.equal((await request({ cmd: 'echo second' })).status, 409);
  const viewed = await (await fetch(base + '/api/approvals', { headers: identityHeaders })).json();
  assert.equal(viewed.pending.id, created.id);
  assert.equal(viewed.pending.detail, 'script preview');

  const answer = password => post('/api/approvals/answer', { id: created.id, password });
  assert.equal((await answer('two\nlines')).status, 409);
  assert.equal((await answer('dummy-test')).status, 200);
  assert.equal((await post('/api/approvals/cancel', { id: created.id })).status, 409);
  const received = await fetch(`${base}/api/approvals/wait?id=${created.id}&claim=${created.claim}`);
  assert.equal(await received.text(), 'dummy-test');

  const next = await (await request({ cmd: 'echo second', attempt: 2 })).json();
  const waiting = fetch(`${base}/api/approvals/wait?id=${next.id}&claim=${next.claim}`);
  assert.equal((await post('/api/approvals/cancel', { id: next.id })).status, 200);
  assert.ok([404, 410].includes((await waiting).status));
  assert.equal((await post('/api/approvals/cancel', { id: next.id })).status, 409);
});
