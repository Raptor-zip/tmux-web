// Optional real x11vnc/noVNC input-to-pixel benchmark; requires Xvfb, x11vnc,
// python3-tk and Playwright. Runs on an isolated display, never the user's screen.
// PLAYWRIGHT_MODULE and CHROME_BIN may point to an existing browser installation.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDesktop } from '../server/src/desktop.js';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const display=`:${200 + process.pid % 1000}`;
const xvfb=spawn('Xvfb',[display,'-screen','0','1920x1080x24','-nolisten','tcp'],{stdio:'ignore'});
let painter,browser,vite,server,desktop;
try {
 await delay(500);
 painter=spawn('python3',[path.join(root,'scripts/benchmark-desktop-scene.py')],{env:{...process.env,DISPLAY:display},stdio:'inherit'});
 vite=await createServer({root:path.join(root,'web'),configFile:false,optimizeDeps:{esbuildOptions:{target:'es2022'}},server:{middlewareMode:true},appType:'custom'});
 server=http.createServer((req,res)=>{
  if(req.url==='/bench'){res.setHeader('Content-Type','text/html');res.end('<html><body style="margin:0"><div id="screen" style="width:1920px;height:1080px"></div></body></html>');}
  else vite.middlewares(req,res);
 });
 server.on('upgrade',(req,socket,head)=>{if(req.url.startsWith('/ws/desktop')) desktop.upgrade(req,socket,head);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN || undefined,args:['--no-sandbox']});
 for(const mode of ['before','after']) {
  desktop=createDesktop({probe:async()=>({display,env:{...process.env,DISPLAY:display}}),spawnVnc:(cmd,args,options)=>{
   if(mode==='before') args=args.filter((arg,i)=>!['-nonap','-threads','-sb','-speeds'].includes(arg)&&!['-sb','-speeds'].includes(args[i-1]));
   return spawn(cmd,args,options);
  }});
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  page.on('pageerror',err=>console.error('pageerror',err.message));
  await page.goto(`http://127.0.0.1:${port}/bench`);
  await page.evaluate(async({port,mode})=>{
   const {LosslessRFB}=await import('/src/vendor/lossless-rfb.ts');
   if(mode==='before') {
    const original=LosslessRFB.messages.clientEncodings;
    LosslessRFB.messages.clientEncodings=(sock,encodings)=>original(sock,[...encodings,-313]);
   }
   window.rfb=new LosslessRFB(document.querySelector('#screen'),`ws://127.0.0.1:${port}/ws/desktop?scale=1&interval=16`);
   rfb.lossless=false;rfb.qualityLevel=8;rfb.compressionLevel=0;
   await new Promise((resolve,reject)=>{rfb.addEventListener('connect',resolve);rfb.addEventListener('disconnect',()=>reject(new Error('disconnect')));setTimeout(()=>reject(new Error('timeout')),10000)});
  },{port,mode});
  await delay(1500);
  const result=await page.evaluate(async()=>{
   const canvas=document.querySelector('canvas');const ctx=canvas.getContext('2d');
   const color=()=>{const p=ctx.getImageData(50,50,1,1).data;return p[0]>p[2];};
   const times=[];
   for(let i=0;i<40;i++){
    const before=color(),start=performance.now();rfb.sendKey(0x61,'KeyA');
    await new Promise((resolve,reject)=>{function check(){if(color()!==before)resolve();else if(performance.now()-start>7000)reject(new Error('frame froze >7s'));else requestAnimationFrame(check)}check()});
    times.push(performance.now()-start);await new Promise(r=>setTimeout(r,60));
   }
   times.sort((a,b)=>a-b);return {samples:times.length,medianMs:Math.round(times[20]),p95Ms:Math.round(times[38]),maxMs:Math.round(times[39])};
  });
  console.log(JSON.stringify({mode,...result}));
  await page.close();desktop.dispose();await delay(200);
 }
} finally {desktop?.dispose();await browser?.close();await vite?.close();server?.close();painter?.kill();xvfb.kill();}
