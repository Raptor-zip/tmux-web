// DOM 描画と WebGL 描画の比較。先に `npx vite build --config scripts/benchmark-terminal-renderer/vite.config.mjs` を実行する。
// hw = 実 GPU（--use-angle=gl-egl）、sw = SwiftShader（GPU の無い環境の代わり）。
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const dist=path.join(__dirname,'dist');
const srv=http.createServer((q,r)=>{const f=path.join(dist,new URL(q.url,'http://x').pathname.replace(/\/$/,'/index.html'));fs.readFile(f,(e,d)=>{if(e){r.statusCode=404;return r.end()}r.setHeader('content-type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html');r.end(d)})});
(async()=>{await new Promise(r=>srv.listen(17999,'127.0.0.1',r));
const gpus={hw:['--enable-gpu','--use-angle=gl-egl'],sw:[]};const out=[];
for(const [g,args] of Object.entries(gpus)){const b=await chromium.launch({headless:true,...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{}),args:['--no-sandbox',...args]});
 for(const rep of [0,1,2])for(const r of ['dom','webgl']){const ctx=await b.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});const p=await ctx.newPage();
  await p.goto(`http://127.0.0.1:17999/?r=${r}&n=4`);await p.waitForFunction(()=>window.ready);const res=await p.evaluate(()=>window.run());res.gpu=g;res.rep=rep;out.push(res);
  console.log(g,r,rep,'flood',res.flood.ms.toFixed(0)+'ms','long',res.flood.longTaskMs.toFixed(0),'| tui frames',res.tui.frames,'p50',res.tui.p50.toFixed(1),'p95',res.tui.p95.toFixed(1),'>33ms',res.tui.over33ms,'longMs',res.tui.longTaskMs.toFixed(0),'canv',res.canvases,res.cols+'x'+res.rows);await ctx.close();}
 await b.close();}
fs.writeFileSync(process.env.OUTPUT||path.join(__dirname,'results.json'),JSON.stringify(out,null,1));srv.close();})();
