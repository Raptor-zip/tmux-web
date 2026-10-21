import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApprovals } from '../src/approvals.js';

async function fixture(t) {
  const app=express();app.use(express.json());const service=createApprovals();service.installHelpers(app);
  app.use('/api',(req,res,next)=>req.headers['x-tmux-web-token']==='test'?next():res.status(401).end());service.install(app);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{service.dispose();server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(url,body,headers={})=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','x-tmux-web-token':'test',...headers},body:JSON.stringify(body)});
  return {service,base,post};
}

test('local helper bypass is narrow, UI uses normal auth and browser-origin registrations are refused',async t=>{
 const {base,post}=await fixture(t);
 assert.equal((await fetch(base+'/api/approvals')).status,401);
 assert.equal((await post('/api/approvals/request',{}, {'Sec-Fetch-Site':'same-origin'})).status,403);
 assert.equal((await post('/api/approvals/request',{}, {'X-Forwarded-For':'100.64.0.1'})).status,403);
 const created=await (await post('/api/approvals/request',{cmd:'test-only'})).json();
 const view=await (await fetch(base+'/api/approvals',{headers:{'x-tmux-web-token':'test'}})).json();
 assert.equal(view.pending.cmd,'test-only');assert.equal(view.pending.claim,undefined);
 assert.equal((await post('/api/approvals/answer',{id:created.id,password:'dummy'},{'Sec-Fetch-Site':'cross-site'})).status,403);
 assert.equal((await post('/api/approvals/answer',{id:created.id,password:'dummy'},{'X-Forwarded-For':'100.64.0.1'})).status,403);
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
