// Presentation-only browser fixture: synthetic projects, terminals and errors.
// Does not contact real tmux APIs or read an existing browser profile.
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {join,resolve}=require('node:path');
const fs=require('node:fs');
const http=require('node:http');
const express=require('express');
const assert=require('node:assert/strict');
const phone=require('./phone.cjs');
const phase=process.argv[2]||'after';
// SCREEN_TAB_CHECK 用の最小 RFB 3.8 サーバ（認証なし・320x200 を 1 枚だけ送る）。
// noVNC は WebSocket の実体を検査するので、Playwright の routeWebSocket ではなく本物のソケットで受ける。
let screenTransports=[];
function fakeRfb(ws){
 const transport={socket:ws,closed:false,keys:[]};screenTransports.push(transport);
 ws.on('close',()=>{transport.closed=true;});
 let stage='version',buffer=Buffer.alloc(0);const W=320,H=200;
 ws.send(Buffer.from('RFB 003.008\n'));
 ws.on('message',raw=>{buffer=Buffer.concat([buffer,Buffer.from(raw)]);
  for(;;){
   if(stage==='version'){if(buffer.length<12)return;buffer=buffer.subarray(12);ws.send(Buffer.from([1,1]));stage='security';continue;}
   if(stage==='security'){if(buffer.length<1)return;buffer=buffer.subarray(1);ws.send(Buffer.from([0,0,0,0]));stage='init';continue;}
   if(stage==='init'){if(buffer.length<1)return;buffer=buffer.subarray(1);const name=Buffer.from('fake');const init=Buffer.alloc(24+name.length);
    init.writeUInt16BE(W,0);init.writeUInt16BE(H,2);Buffer.from([32,24,0,1,0,255,0,255,0,255,16,8,0,0,0,0]).copy(init,4);init.writeUInt32BE(name.length,20);name.copy(init,24);ws.send(init);stage='normal';continue;}
   if(buffer.length<1)return;const type=buffer[0];
   if(type===0){if(buffer.length<20)return;buffer=buffer.subarray(20);continue;}
   if(type===2){if(buffer.length<4)return;const n=buffer.readUInt16BE(2);if(buffer.length<4+n*4)return;buffer=buffer.subarray(4+n*4);continue;}
   if(type===3){if(buffer.length<10)return;const incremental=buffer[1];buffer=buffer.subarray(10);if(incremental&&transport.framed)continue;transport.framed=true;
    const head=Buffer.alloc(16);head.writeUInt16BE(1,2);head.writeUInt16BE(W,8);head.writeUInt16BE(H,10);head.writeInt32BE(0,12);
    const pixels=Buffer.alloc(W*H*4);for(let i=0;i<W*H;i++){pixels[i*4]=0x40;pixels[i*4+1]=0x90;pixels[i*4+2]=0x30;}ws.send(Buffer.concat([head,pixels]));continue;}
   if(type===4){if(buffer.length<8)return;transport.keys.push({down:buffer[1],key:buffer.readUInt32BE(4)});buffer=buffer.subarray(8);continue;}
   if(type===5){if(buffer.length<6)return;buffer=buffer.subarray(6);continue;}
   if(type===6){if(buffer.length<8)return;const n=buffer.readUInt32BE(4);if(buffer.length<8+n)return;buffer=buffer.subarray(8+n);continue;}
   buffer=Buffer.alloc(0);return;
  }
 });
}

const root=resolve(__dirname,'../..');
const out=process.env.TEST_OUTPUT||join(root,'artifacts/visual-feedback',phase);fs.mkdirSync(out,{recursive:true});
const testPort=Number(process.env.TEST_PORT||17656);
const now=1792597800000;
const deviceNames={local:'ThinkPad',spark:'DGX Spark'};
const projects=['atlas-web','orbital-navigation-console','atlas-web','billing-service','research-notes','design-system'];
function state(device){
 const sessions=[{id:'$1',name:'development',windows:12,created:now-3600000,activity:now,attached:1,group:null,groupSize:1,path:'/home/demo/projects'}];
 const windows=Array.from({length:12},(_,i)=>({id:'@'+(i+1),sessionId:'$1',sessionName:'development',index:i,name:['UIの調整','APIと認証を実装','テストとビルド','データの解析'][i%4],active:i===0,panes:1,layout:'',zoomed:false,activity:false,lastActivity:now,bell:false,width:120,height:32}));
 const panes=windows.map((w,i)=>({id:'%'+(i+1),sessionId:'$1',windowId:w.id,index:0,active:true,title:w.name,busy:i%3===0,command:'node',path:'/home/demo/projects/'+projects[i%projects.length],pid:1000+i,width:120,height:32,left:0,top:0,dead:false,inMode:false,proc:{kind:'agent',agent:i%2?'Claude':'Codex',command:i%2?'claude':'codex',ports:[],since:now-1800000},project:{root:'/home/demo/projects/'+projects[i%projects.length],name:projects[i%projects.length]}}));
 // SIDEBAR_CHECK：一覧の『別のセッションへ移す / まとめる』を試すため、2 つ目のセッションを足す
 if(process.env.SIDEBAR_CHECK){sessions.push({id:'$2',name:'notes',windows:2,created:now-3600000,activity:now,attached:0,group:null,groupSize:1,path:'/home/demo/notes'});
  for(const n of [13,14]){windows.push({id:'@'+n,sessionId:'$2',sessionName:'notes',index:n-13,name:'メモ'+(n-12),active:n===13,panes:1,layout:'',zoomed:false,activity:false,lastActivity:now,bell:false,width:120,height:32});
   panes.push({id:'%'+n,sessionId:'$2',windowId:'@'+n,index:0,active:true,title:'メモ'+(n-12),busy:false,command:'vim',path:'/home/demo/notes',pid:1000+n,width:120,height:32,left:0,top:0,dead:false,inMode:false,proc:{kind:'run',command:'vim',ports:[],since:now-1800000},project:{root:'/home/demo/notes',name:'notes'}});}}
 return{sessions,windows,panes,serverPid:device==='local'?501:502,ts:now,server:{version:'tmux 3.4',prefix:'C-b',socketName:'default',home:'/home/demo',device:{name:deviceNames[device],color:device==='local'?'#205683':'#266c5b',accent:device==='local'?'#70b8ff':'#69d3b5',fingerprint:device==='local'?'10000001':'20000002'}}};
}
function tab(n,device='local'){return{id:'tab-'+device+'-'+n,sessionId:device==='local'?'$1':'spark~$1',windowId:(device==='local'?'':'spark~')+'@'+n,sessionName:'development',windowIndex:n-1,windowName:state(device).windows[n-1].name};}
function leaf(n,device='local',extra=[]){const t=tab(n,device);return{type:'leaf',id:'panel-'+device+'-'+n,tabs:[t,...extra],activeId:t.id};}
function four(){return{type:'split',id:'split1',dir:'row',ratio:.25,a:leaf(1,'local',[tab(5)]),b:{type:'split',id:'split2',dir:'row',ratio:1/3,a:leaf(2),b:{type:'split',id:'split3',dir:'row',ratio:.5,a:leaf(1,'spark'),b:leaf(3)}}};}
const scenes=[
 ...[
  {name:'remote-entry-desktop',width:1280,height:800},
  {name:'remote-entry-mobile',width:390,height:844,touch:true},
  {name:'remote-viewer-desktop',width:1280,height:800,action:'desktop'},
  {name:'remote-viewer-mobile',width:390,height:844,touch:true,action:'desktop'},
  {name:'remote-viewer-landscape',width:740,height:390,touch:true,action:'desktop'},
  {name:'remote-clipboard-mobile',width:390,height:844,touch:true,action:'desktop',remotePanel:'clipboard'},
  {name:'remote-settings-desktop',width:1280,height:800,action:'desktop',remotePanel:'settings'},
 ].map(scene=>({...scene,tree:leaf(1)})),
 {name:"desktop-controls",width:1280,height:800,sidebar:true,tree:leaf(1)},
 {name:"project-desktop",width:1280,height:800,sidebar:true,tree:leaf(1),action:"project"},
 {name:'desktop-four',width:1920,height:1080,tree:four()},
 {name:'laptop-four',width:1280,height:800,tree:four()},
 {name:'tablet-two',width:900,height:1024,touch:true,sidebar:true,tree:{type:'split',id:'split1',dir:'row',ratio:.5,a:leaf(1),b:leaf(1,'spark')}},
 {name:'mobile-panels',width:390,height:844,touch:true,tree:four()},
 {name:'mobile-landscape',width:740,height:390,touch:true,tree:four()},
 {name:'many-tabs',width:1100,height:800,tree:leaf(1,'local',Array.from({length:11},(_,i)=>tab(i+2)))},
 {name:'terminal-selection',width:390,height:844,touch:true,tree:leaf(1,'local',[tab(2)])},
 {name:'terminal-target',width:1280,height:800,tree:leaf(1,'local',[tab(2),tab(1,'spark')])},
 {name:'switcher-desktop',width:1280,height:800,tree:leaf(1),action:'switcher'},
 {name:'switcher-mobile',width:390,height:844,touch:true,tree:leaf(1),action:'switcher'},
 {name:'switcher-landscape',width:740,height:390,touch:true,tree:leaf(1),action:'switcher'},
 {name:'focus-panel',width:1280,height:800,tree:four(),action:'focus'},
 {name:'devices-modal',width:390,height:844,tree:leaf(1),action:'devices'},
 {name:'project-modal',width:390,height:640,sidebar:true,tree:leaf(1),action:'project'},
 {name:'desktop-modal',width:390,height:844,tree:leaf(1),action:'desktop'},
 {name:'files-modal',width:390,height:844,tree:leaf(1),action:'files'},
 {name:'files-desktop',width:1280,height:800,tree:leaf(1),action:'files'},
 {name:'offline-panel',width:900,height:700,tree:{type:'split',id:'split1',dir:'row',ratio:.5,a:leaf(1),b:leaf(1,'spark')},offline:true},
];
const output=(label)=>'\x1b[2J\x1b[H\x1b[?25l\x1b[1;36m'+label+'\x1b[0m\r\n\x1b[90m~/projects/atlas-web · feature/responsive-ui\x1b[0m\r\n\r\n\x1b[1mタスク：使いやすい端末ワークスペースを作る\x1b[0m\r\n\r\n  ✓ 接続先と作業名を確認\r\n  ✓ タブと分割の配置を保存\r\n  ✓ 狭い画面での操作を検証\r\n\r\n\x1b[1;32m実装の進捗\x1b[0m\r\n  狭いパネルでも作業名と状態が分かる構成にします。\r\n  デバイスごとの端末を同じ画面で操作できます。\r\n\r\n  src/components/Workspace.tsx    +24 −12\r\n  src/styles.css                 +48 −20\r\n\r\n\x1b[32m  18 tests passed\x1b[0m\r\n\x1b[90m  次にブラウザで表示を確認します。\x1b[0m\r\n\r\n────────────────────────────────────────\r\n\x1b[1m› 次の作業を入力…\x1b[0m\r\n';
(async()=>{
 const app=express();
 if(process.env.COMPRESSED_STATIC){const {installWeb}=await import('../../server/src/web.js');installWeb(app,process.env.STATIC_ROOT||join(root,'web/dist'));}
 else{app.use(express.static((process.env.STATIC_ROOT||join(root,'web/dist'))));app.get('*',(_q,r)=>r.sendFile(join(process.env.STATIC_ROOT||join(root,'web/dist'),'index.html')));}
 const server=http.createServer(app);await new Promise(r=>server.listen(testPort,'127.0.0.1',r));
 if(process.env.SCREEN_TAB_CHECK){const {WebSocketServer}=require('ws');const wss=new WebSocketServer({noServer:true});
  server.on('upgrade',(req,socket,head)=>{if(!/\/desktop(\?|$)/.test(req.url)){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>fakeRfb(ws));});}
 const browser=process.env.BROWSER_ENGINE==='webkit'
  ? await webkit.launch({headless:true,...(process.env.WEBKIT_BIN?{executablePath:process.env.WEBKIT_BIN}:{})})
  : await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/home/somak/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',args:['--no-sandbox',...(process.env.CHROME_ARGS?process.env.CHROME_ARGS.split(' '):[])]});
 const results=[];
 try{
 for(const scene of scenes.filter(scene=>!process.env.SCREENS || process.env.SCREENS.split(',').includes(scene.name))){
  const context=await browser.newContext({viewport:{width:scene.width,height:scene.height},deviceScaleFactor:1,hasTouch:!!scene.touch,reducedMotion:'reduce',locale:'ja-JP',serviceWorkers:'block'});
  await context.addInitScript(({tree,sidebar,now,keepStorage,direct})=>{Date.now=()=>now;if(direct)localStorage.setItem('tw.mode','"direct"');if(keepStorage && sessionStorage.getItem('desktop-transfer-initialized'))return;sessionStorage.setItem('desktop-transfer-initialized','1');localStorage.setItem('tw.layout',JSON.stringify(tree));localStorage.setItem('tw.sidebar',JSON.stringify(!!sidebar));localStorage.setItem('tw.serverPid','"local:501|spark:502"');localStorage.setItem('tw.focusedLeaf',JSON.stringify('panel-local-1'));},{tree:scene.tree,sidebar:scene.sidebar,now,keepStorage:!!process.env.DESKTOP_TRANSFER_CHECK,direct:!!process.env.TERMINAL_DIRECT_CHECK});
  if(process.env.TERMINAL_RENDERER)await context.addInitScript(renderer=>localStorage.setItem('tw.renderer',JSON.stringify(renderer)),process.env.TERMINAL_RENDERER);
  const page=await context.newPage();if(process.env.CONNECTION_CHECK||process.env.NO_SCREENSHOTS)page.screenshot=async()=>{};const errors=[],apiRequests=[];let terminalConnections=0;let activeTerminals=0;let releaseTerminalReady;const terminalInputs=[];const terminalTransports=[],terminalSelections=[];screenTransports=[];let workspaceState={type:'workspace',initialized:false,revision:0,values:{}};const transferTasks=[],transfers=[];page.on('pageerror',e=>errors.push(e.message));
  if(process.env.TRANSFER_REPORT)page.on('requestfinished',request=>{
   const url=new URL(request.url());if(!/\.(?:js|css)$/.test(url.pathname))return;
   transferTasks.push((async()=>{const response=await request.response();const headers=await response.allHeaders();const sizes=await request.sizes();transfers.push({asset:url.pathname.split('/').at(-1),encoding:headers['content-encoding']||'identity',wireBodyBytes:sizes.responseBodySize,decodedBytes:(await response.body()).length});})().catch(error=>errors.push(error.message)));
  });
  if(process.env.TRANSFER_REPORT){
   await page.addInitScript(()=>{new MutationObserver((_,observer)=>{const button=document.querySelector('.input-bar .input-enter');if(button&&!button.disabled){window.__terminalReadyAt=performance.now();observer.disconnect();}}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled']});});
   if(process.env.THROTTLE_KBPS){const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.send('Network.emulateNetworkConditions',{offline:false,downloadThroughput:Number(process.env.THROTTLE_KBPS)*1000/8,uploadThroughput:100000,latency:Number(process.env.THROTTLE_RTT_MS||0)});}
  }
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),remote=url.pathname.includes('/devices/spark/proxy/'),path=remote?url.pathname.split('/proxy')[1]:url.pathname;apiRequests.push({method:route.request().method(),path:url.pathname,body:route.request().postData()});
   let body={};let status=200;
   if(path==='/api/devices')body={devices:[{id:'local',name:'ThinkPad',local:true},{id:'spark',name:'DGX Spark',local:false,url:'https://spark.example.ts.net:8443'}]};
   else if(path==='/api/state'){body=state(remote?'spark':'local');if(remote&&scene.offline){body={error:'デバイスに接続できません'};status=502;}}
   else if(path==='/api/approvals')body={pending:null,secure:true};
   else if(path==='/api/projects/recent')body={projects:[]};
   else if(path==='/api/desktop/status'&&process.env.SCREEN_TAB_CHECK)body={available:true,width:320,height:200,viewers:screenTransports.filter(t=>!t.closed).length};
   else if(path==='/api/desktop/ping')body={ok:true};
   else if(path==='/api/desktop/status')body={available:false,error:'デスクトップに接続できません。デバイスのログイン状態を確認してください。',viewers:0};
   else if(path==='/api/files')body={root:'/home/demo/projects/atlas-web',path:'',items:[{name:'src',path:'src',directory:true,size:0,modified:now,mime:''},{name:'responsive-workspace-review.md',path:'responsive-workspace-review.md',directory:false,size:2840,modified:now,mime:'text/plain'},{name:'package.json',path:'package.json',directory:false,size:960,modified:now,mime:'text/plain'}]};
   else if(path==='/api/keys')body={keys:[]};
   else if(path==='/api/action')body={ok:true,result:null};
   else if(path==='/api/capture'&&process.env.SIDEBAR_CHECK)body={target:url.searchParams.get('target'),text:'$ make\nsidebar-capture: ok\n$ '};
   else if(path==='/api/capture'&&process.env.TAB_MENU_CHECK)body={target:url.searchParams.get('target'),text:'$ npm test\ntab-menu-capture: 76 passed\n$ '};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.routeWebSocket(url=>/\/ws\//.test(url.pathname)&&!(process.env.SCREEN_TAB_CHECK&&/\/desktop$/.test(url.pathname)),ws=>{
   const url=new URL(ws.url()),remote=url.pathname.includes('/devices/spark/');
   if(url.pathname.endsWith('/workspace')){
    const send=extra=>ws.send(JSON.stringify({...workspaceState,...extra}));send();
    ws.onMessage(raw=>{const message=JSON.parse(String(raw));if(message.type==='refresh'){send();return;}if(message.type!=='workspace-patch')return;
     const conflict=Object.entries(message.changes).some(([key,change])=>(workspaceState.values[key]??null)!==change.before);
     if(conflict){send({ack:message.id,conflict:true});return;}
     for(const [key,change] of Object.entries(message.changes)){if(change.after===null)delete workspaceState.values[key];else workspaceState.values[key]=change.after;}
     workspaceState.initialized=true;workspaceState.revision++;send({ack:message.id});
    });
   }
   else if(url.pathname.endsWith('/events')){if(remote&&scene.offline){ws.close();return;}const send=()=>ws.send(JSON.stringify({type:'state',...state(remote?'spark':'local')}));send();ws.onMessage(send);}
   else if(url.pathname.endsWith('/terminal')){
    const acknowledge=(!!process.env.TERMINAL_SELECTION_CHECK && scene.name==='terminal-selection')||!!process.env.TERMINAL_DIRECT_CHECK;
    const transport={socket:ws,remote,window:url.searchParams.get('window'),mode:url.searchParams.get('mode'),selections:[],inputs:[]};
    terminalConnections++;activeTerminals++;terminalTransports.push(transport);ws.onClose((code,reason)=>{transport.closeEvents=(transport.closeEvents||0)+1;if(transport.closed)return;transport.closed=true;activeTerminals--;void ws.close({code,reason}).catch(()=>{});});
    if(remote&&scene.offline){ws.send(JSON.stringify({type:'error',message:'接続先がオフラインです。再接続しています。'}));ws.close();return;}
    const ready=()=>{ws.send(JSON.stringify({type:'ready',mode:'mirror',...(acknowledge?{selectionAck:true,windowId:url.searchParams.get('window')}:{})}));ws.send(Buffer.from('\x1b[?1000h\x1b[?1006h'+output(deviceNames[remote?'spark':'local'])));};
    if(process.env.TERMINAL_READY_CHECK && scene.name==='mobile-panels' && terminalConnections===1) releaseTerminalReady=ready;
    else ready();
    ws.onMessage(message=>{try{const data=JSON.parse(String(message));if(data.type==='input'){terminalInputs.push(data.data);transport.inputs.push(data.data);}else if(data.type==='selectWindow'){terminalSelections.push({...data,remote});transport.selections.push(data);if(process.env.TERMINAL_DIRECT_CHECK)ws.send(JSON.stringify({type:'selectedWindow',requestId:data.requestId,windowId:data.windowId}));}}catch{}});
   }
  });
  const checkStateConnection=process.env.STATE_CONNECTION_CHECK && scene.name==='desktop-four' ? await require('./state-connection.cjs')(page,{state,terminals:()=>activeTerminals}) : null;
  const checkSwitcher=process.env.SWITCHER_CHECK && scene.action==='switcher' ? await require('./switcher.cjs')(page,{state,scene}) : null;
  await page.goto(`http://127.0.0.1:${testPort}/`);await page.locator('.xterm').first().waitFor();await page.waitForTimeout(2800);
  if(checkStateConnection) await checkStateConnection();
  if(process.env.TERMINAL_WAKE_CHECK) await require('./terminal-wake.cjs')(page,{terminalTransports,terminalInputs});
  if(process.env.SCREEN_TAB_CHECK && scene.name==='terminal-target') await require('./screen-tab.cjs')(page,{screenTransports,terminalTransports,workspace:()=>workspaceState,out});
  if(process.env.TERMINAL_WEBGL_CHECK) await require('./terminal-webgl.cjs')(page,{terminalTransports,terminalInputs});
  if(process.env.TERMINAL_SELECTION_CHECK && scene.name==='terminal-selection') await require('./terminal-selection.cjs')(page,{terminalTransports,terminalInputs,phase,out});
  if(process.env.TERMINAL_DIRECT_CHECK && scene.name==='terminal-target') await require('./terminal-direct.cjs')(page,{terminalTransports});
  if(process.env.TAB_MENU_CHECK && (scene.name==='terminal-target' || scene.name==='terminal-selection')) await require('./tab-menu.cjs')(page,{scene,out,touch:!!scene.touch});
  if(process.env.ALT_NAV_CHECK && scene.name==='laptop-four'){await require('./alt-nav.cjs')(page,{terminalInputs});assert.deepEqual(errors,[],'alt navigation runtime errors');}
  if(process.env.TERMINAL_TARGET_CHECK && scene.name==='terminal-target') await require('./terminal-target.cjs')(page,{terminalTransports,terminalSelections});
  if(process.env.TERMINAL_READY_CHECK && scene.name==='mobile-panels'){
   assert.equal(await page.locator('.input-bar .input-enter').isDisabled(),true,'transport open does not enable Enter before terminal ready');
   assert.equal(await page.locator('.input-bar .input-keys .key').first().isDisabled(),true,'transport open does not enable the key row before terminal ready');
   const inputToggle=page.locator('.input-bar').getByRole('button',{name:'入力',exact:true});
   await inputToggle.click();
   assert.equal(await page.locator('.input-bar .input-attach').isDisabled(),true,'transport open does not enable attachments before terminal ready');
   await page.getByRole('textbox',{name:'下書き',exact:true}).fill('ready後に挿入');
   assert.equal(await page.getByRole('button',{name:'挿入のみ',exact:true}).isDisabled(),true);
   assert.equal(typeof releaseTerminalReady,'function');releaseTerminalReady();
   await page.locator('.input-bar .input-attach:enabled').waitFor();
   await page.getByRole('button',{name:'挿入のみ',exact:true}).click();
   assert.equal(terminalInputs.at(-1),'ready後に挿入');
   await inputToggle.click();
   console.log('terminal controls wait for tmux readiness and preserve the draft');
  }
  const togglePanel=async()=>{await phone.focusedHead(page).getByRole('button',{name:'タブの操作',exact:true}).click();await page.getByRole('menuitem',{name:'配置',exact:true}).click();await page.getByRole('menuitem',{name:/^(パネルを最大化|並びに戻す)/}).click();};
  if(process.env.ATTACHMENT_CHECK && scene.name==='mobile-panels') await require('./attachments.cjs')(page, terminalInputs, terminalTransports);
  const checkFiles=process.env.FILES_CHECK && scene.action==='files' ? await require('./files.cjs')(page,{scene,phase,out}) : null;
  // ⌕ は上バーの右端。スマホ縦では見出しに無く、タブ一覧シートの『すべての端末を探す』から開く
  if(scene.action==='switcher')await phone.openPalette(page);
  if(checkSwitcher) await checkSwitcher();
  if(scene.action==='focus')await page.keyboard.press('Alt+Enter');
  if(scene.action==='devices'){await phone.openConnection(page);await page.getByRole('dialog',{name:'接続状態',exact:true}).getByRole('button',{name:'デバイス接続を管理…',exact:true}).click();}
  // 『その他・検索…』は無くなった。プロジェクトの作成は一覧の見出しの『＋ 新規 ▾』（選択中のデバイスの新規メニュー）から
  if(scene.action==='project'){if(phase==='before'){await page.locator('.sidebar-more > summary').click();await page.getByRole('button',{name:'プロジェクトを作る',exact:true}).click();}else{await page.locator('.sidebar').getByRole('button',{name:'新規',exact:true}).click();await page.getByRole('menuitem',{name:'プロジェクトを作る…',exact:true}).click();}}
  if(scene.action==='desktop'){if(phase==='before'){await page.locator('.tile.focused').getByRole('button',{name:'パネルの操作',exact:true}).click();}else{await phone.focusedHead(page).getByRole('button',{name:'新規メニュー',exact:true}).click();await page.getByRole('menuitem',{name:'リモートデスクトップ',exact:true}).click();}await page.getByRole('menuitem',{name:phase==='before'?'デバイスの画面を見る':'ダイアログで開く',exact:true}).click();}
  if(scene.action==='files'){await phone.focusedHead(page).getByRole('button',{name:'タブの操作',exact:true}).click();await page.getByRole('menuitem',{name:/^作業フォルダーを開く/}).click();}
  if(checkFiles) await checkFiles();
  if(scene.name.startsWith('remote-') && scene.action==='desktop'){
   // 上バーのモニタアイコンは無くなった。リモートデスクトップは新規メニューの『リモートデスクトップ ▸』→『ダイアログで開く』から開く（上の desktop の操作）
   if(phase==='after')assert.equal(await page.locator('.desktop-bar').getByRole('button',{name:'リモートデスクトップ',exact:true}).count(),0,'no monitor icon in the workspace bar');
   await page.getByRole('dialog',{name:'リモートデスクトップ',exact:true}).waitFor();
   if(scene.remotePanel){
    if(phase==='before')await page.locator('.desktop-more summary').click();
    // 画質は画面メニュー（ダイアログの ⋯）→『画質…』のモーダル、文字入力は見出しの ⌨
    if(phase==='before')await page.getByRole('button',{name:scene.remotePanel==='clipboard'?'文字・クリップボード':'画質・遅延設定',exact:true}).click();
    else if(scene.remotePanel==='settings'){await page.getByRole('button',{name:'画面の操作',exact:true}).click();await page.getByRole('menuitem',{name:'画質…',exact:true}).click();await page.getByRole('dialog',{name:'画質',exact:true}).waitFor();}
    else await page.getByRole('button',{name:'文字入力',exact:true}).click();
   }
  }
  await page.waitForTimeout(120);if(!(process.env.TERMINAL_SELECTION_CHECK && scene.name==='terminal-selection'))await page.screenshot({path:join(out,scene.name+'.png'),animations:'disabled'});
  const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,visiblePanels:[...document.querySelectorAll('.tile')].filter(el=>!!el.getClientRects().length).map(el=>({width:Math.round(el.getBoundingClientRect().width),headerWidth:el.querySelector('.tablist')?.clientWidth||0})),remoteStage:(()=>{const el=document.querySelector('.desktop-stage');if(!el)return null;const r=el.getBoundingClientRect();return {width:r.width,height:r.height,areaRatio:r.width*r.height/(innerWidth*innerHeight)};})(),dialogs:[...document.querySelectorAll('[role="dialog"],dialog[open]')].map(el=>({label:el.getAttribute('aria-label'),width:Math.round(el.getBoundingClientRect().width)}))}));
  if(process.env.TRANSFER_REPORT){await Promise.all(transferTasks);fs.writeFileSync(process.env.TRANSFER_REPORT,JSON.stringify({screen:scene.name,conditions:{downloadKbps:Number(process.env.THROTTLE_KBPS)||null,latencyMs:Number(process.env.THROTTLE_RTT_MS)||0,coldContext:true},timings:await page.evaluate(()=>({firstContentfulPaint:performance.getEntriesByName('first-contentful-paint')[0]?.startTime||null,terminalReady:window.__terminalReadyAt||null})),transfers},null,2));console.log('asset transfers',JSON.stringify(transfers));}
  results.push({screen:scene.name,width:scene.width,height:scene.height,...metrics,errors});
  if(phase==='after'){assert.deepEqual(errors,[],scene.name+' runtime errors');assert.equal(metrics.overflow,false,scene.name+' horizontal page overflow');}
  if(phase==='after' && process.env.REMOTE_COMPACT_CHECK && scene.action==='desktop') {
   await require('./remote-layout.cjs')(page,scene);
   assert.deepEqual(errors,[], 'remote layout runtime errors');
  }
  if(phase==='after' && process.env.REMOTE_CLIPBOARD_CHECK && scene.name==='remote-viewer-desktop') {
   await require('./remote-clipboard.cjs')(page,{out,screenshot:!process.env.NO_SCREENSHOTS});
   assert.deepEqual(errors,[], 'remote clipboard runtime errors');
  }
  if(phase==='after' && process.env.DESKTOP_CONTEXT_CHECK && scene.name.startsWith('remote-entry-')) {
   await require('./desktop-context.cjs')(page,{scene,out,screenshots:!process.env.NO_SCREENSHOTS});
   assert.deepEqual(errors,[], 'desktop context runtime errors');
  }
  if(phase==='after' && process.env.FORM_CHECK){
   assert.doesNotMatch(await page.title(),/tmux[ -]?web/i,'product name removed from browser title');
   assert.equal(await page.locator('.brand').count(),0,'no redundant sidebar brand');
   assert.deepEqual(await page.locator('body *:visible').evaluateAll(elements=>elements.filter(el=>{
    const s=getComputedStyle(el);return [s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomLeftRadius,s.borderBottomRightRadius].some(v=>parseFloat(v)!==0);
   }).map(el=>el.className)),[],'all visible UI corners are square');
   for(const select of await page.locator('select:visible').all()){
    const style=await select.evaluate(el=>({appearance:getComputedStyle(el).appearance,arrow:getComputedStyle(el).backgroundImage,height:el.getBoundingClientRect().height}));
    assert.equal(style.appearance,'none');assert.notEqual(style.arrow,'none');assert.ok(style.height>=(scene.width<=1024?44:34));
   }
   if(scene.name==='desktop-controls'){
    // ステータスバーは無くなった。文字サイズと行間はパレットの『操作』から変える
    const runCommand=async name=>{const palette=page.getByRole('dialog',{name:'探す・操作',exact:true});await page.locator('.desktop-bar .bar-palette').click();await palette.waitFor();await palette.getByRole('combobox').fill('>'+name);await palette.locator('.sw-row.on .sw-command',{hasText:name}).waitFor();await page.keyboard.press('Enter');await palette.waitFor({state:'detached'});};
    const stored=key=>page.evaluate(k=>localStorage.getItem(k),key);
    await runCommand('文字サイズを最小にする');
    assert.equal(await stored('tw.fontSize'),'6');
    await runCommand('行間を詰める');
    assert.equal(await stored('tw.lineHeight'),'1.14');
    await runCommand('行間を最小にする');
    assert.equal(await stored('tw.lineHeight'),'1');
    await page.waitForTimeout(150);
   }
   if(scene.action==='project'){
    const select=page.getByRole('combobox',{name:'テンプレート',exact:true});
    await select.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
    assert.equal(await select.inputValue(),'node','select retains native keyboard behavior');
   }
   assert.deepEqual(errors,[],'no runtime errors after form and font interactions');
  }

  if(phase==='after' && process.env.SIDEBAR_CHECK && (scene.name==='desktop-controls' || scene.name==='tablet-two')){
   await require('./sidebar.cjs')(page,{scene,out,requests:apiRequests,screenshots:!process.env.NO_SCREENSHOTS});
   assert.deepEqual(errors,[],'sidebar runtime errors');
  }
  if(phase==='after' && process.env.SETTINGS_CHECK && (scene.name==='desktop-controls' || scene.name==='mobile-panels')){
   await require('./settings.cjs')(page,{scene,terminalTransports,out});
   assert.deepEqual(errors,[],'settings runtime errors');
  }
  if(phase==='after' && process.env.SAFETY_CHECK && (scene.action==='devices' || scene.name==='desktop-controls')){
   await require('./safety.cjs')(page,{scene,terminalInputs,requests:apiRequests});
   assert.deepEqual(errors,[],'safety check runtime errors');
  }
  if(process.env.DESKTOP_TRANSFER_CHECK) await require('./desktop-transfer.cjs')(page, errors, () => {workspaceState={type:'workspace',initialized:false,revision:0,values:{}};});
  console.log(scene.name,JSON.stringify(metrics));
  if(phase==='after' && (scene.name==='mobile-panels' || scene.name==='mobile-landscape') && await page.evaluate(([w,h])=>innerWidth===w&&innerHeight===h,[scene.width,scene.height])){
   // スマホは見出し 1 行と入力行 1 行だけ。縦は合計 88px 以下（44+44）、横は 76px 以下（36+40）
   const frame=await page.evaluate(()=>({head:document.querySelector('.desktop-bar').getBoundingClientRect().height,input:document.querySelector('.input-bar .input-row')?.getBoundingClientRect().height??0,strips:[...document.querySelectorAll('.tabstrip')].filter(el=>el.getClientRects().length).length}));
   assert.ok(frame.input>0,'the input row is shown on phones');
   assert.equal(frame.strips,0,'the tile tab strip folds into the one-line phone header');
   assert.ok(frame.head+frame.input<=(scene.name==='mobile-panels'?88:76),scene.name+' chrome height '+JSON.stringify(frame));
   const bar=page.locator('.desktop-bar');
   for(const name of ['一覧','新しい端末','タブの操作'])assert.equal(await bar.getByRole('button',{name,exact:true}).count(),1,'the phone header keeps '+name);
   assert.match(await bar.locator('.phone-tab').textContent(),/atlas-web.*1\/5/,'the header shows the current tab and n/m');
   assert.equal(await bar.locator('.desktop-tab:visible').count(),0,'workspace tabs move into the tab sheet');
   assert.equal(await bar.locator('.bar-palette:visible').count(),scene.name==='mobile-landscape'?1:0,'⌕ stays in the header only in landscape');
   assert.equal(await bar.locator('.bar-chip.needs:visible').count(),1,'waiting and approvals fold into 要対応 N');
   if(scene.name==='mobile-landscape'){
    // 『横持ちで見出しを隠す』：隠れた見出しは、上端のタップか、フォーカスが見出しへ移ると戻る
    const settings=page.getByRole('dialog',{name:'表示と接続',exact:true});
    const setHide=async on=>{await phone.openConnection(page);await page.getByRole('button',{name:'表示と接続…',exact:true}).click();await settings.waitFor();const toggle=settings.getByRole('switch',{name:/横持ちで見出しを隠す/});if(await toggle.getAttribute('aria-checked')!==String(on))await toggle.click();await page.keyboard.press('Escape');await settings.waitFor({state:'detached'});};
    const headBottom=()=>bar.evaluate(el=>el.getBoundingClientRect().bottom);
    await setHide(true);
    await page.locator('.tile:visible .terminal-host').first().click({position:{x:120,y:120}});
    await page.waitForFunction(()=>document.querySelector('.desktop-bar').getBoundingClientRect().bottom<=1);
    await page.screenshot({path:join(out,'mobile-landscape-hidden-header.png'),animations:'disabled'});
    await page.mouse.click(300,4);
    await page.waitForFunction(()=>document.querySelector('.desktop-bar').getBoundingClientRect().top>=0);
    assert.ok(await headBottom()>30,'tapping the top edge brings the header back');
    await page.locator('.tile:visible .terminal-host').first().click({position:{x:120,y:120}});
    await page.waitForFunction(()=>document.querySelector('.desktop-bar').getBoundingClientRect().bottom<=1);
    await bar.getByRole('button',{name:'一覧',exact:true}).focus();
    await page.waitForFunction(()=>document.querySelector('.desktop-bar').getBoundingClientRect().top>=0);
    await setHide(false);
   }
  }
  if(phase==='after' && scene.name==='mobile-panels'){
   // ATTACHMENT_CHECK opens a second tab in the same panel, and a visited tab keeps its connection.
   assert.equal(activeTerminals,process.env.ATTACHMENT_CHECK?2:1,'only the visible mobile panel attaches');
   const layout=await page.evaluate(()=>localStorage.getItem('tw.layout'));
   assert.equal(await page.locator('.tile:visible .tab-count').count(),0,'the tab count badge is gone');
   if(await phone.isPhoneHead(page)){
   // 見出しの『現在のタブ ▾ n/m』でタブ一覧シート：⌕・接続状態・ワークスペース・パネル別のタブ
   await page.locator('.desktop-bar .phone-tab').click();
   const sheet=page.getByRole('dialog',{name:'タブ一覧',exact:true});
   await sheet.waitFor();
   assert.equal(await sheet.getByRole('button',{name:'すべての端末を探す',exact:true}).count(),1);
   assert.match(await sheet.getByRole('button',{name:/^接続状態：/}).getAttribute('aria-label'),/接続/);
   assert.equal(await sheet.getByRole('group',{name:'ワークスペース',exact:true}).getByRole('button',{name:'新しいワークスペース',exact:true}).count(),1);
   assert.equal(await sheet.locator('.tsheet-panel').count(),4,'one section per panel');
   assert.match(await sheet.locator('.tsheet-panel').first().locator('.tsheet-label').textContent(),/^パネル「atlas-web」 · 入力先$/);
   assert.equal(await sheet.locator('.tsheet-tab[aria-current=true]').getAttribute('data-sheet-tab'),'tab-local-1');
   await page.screenshot({path:join(out,'panel-overview.png'),animations:'disabled'});
   await sheet.locator('[data-sheet-tab=tab-spark-1]').click();
   await sheet.waitFor({state:'detached'});
   await page.waitForTimeout(100);
   assert.match(await page.locator('.desktop-bar .phone-tab').textContent(),/4\/5/,'n/m follows the picked tab');
   }else{
    // TERMINAL_WAKE_CHECK は画面の幅を変える。スマホの見出しでなければ、見出しのチップからパレットの『タブ』で選ぶ
    await page.locator('.tile:visible').getByRole('button',{name:'他 3 パネル',exact:true}).click();
    const palette=page.getByRole('dialog',{name:'探す・操作',exact:true});
    await palette.getByRole('combobox',{name:'探す・操作'}).fill('DGX Spark');
    await palette.locator('.sw-tab').click();
    await page.waitForTimeout(100);
   }
   assert.equal(await page.locator('.tile:visible [role=tab][aria-selected=true]').getAttribute('data-tab-id'),'tab-spark-1');
   assert.equal(await page.locator('.tile:visible').count(),1);
   await page.setViewportSize({width:1920,height:1080});await page.waitForTimeout(150);
   assert.equal(await page.locator('.tile:visible').count(),4,'restores split after resize');
   const splitDeadline=Date.now()+5000;
   // ATTACHMENT_CHECK visited @5 in the @1 panel; a visited tab in a visible panel may keep its connection.
   const splitTerminals=()=>4+(process.env.ATTACHMENT_CHECK&&terminalTransports.some(t=>t.window==='@5'&&!t.remote&&!t.closed)?1:0);
   while(activeTerminals!==splitTerminals() && Date.now()<splitDeadline)await page.waitForTimeout(20);
   assert.equal(activeTerminals,splitTerminals(),'only visible split panels retain websocket connections '+JSON.stringify(terminalTransports.map(t=>({window:t.window,remote:t.remote,closes:t.closeEvents||0}))));
   await page.setViewportSize({width:900,height:1024});await page.waitForTimeout(150);
   for(const target of await page.locator('.editorbar-actions .icon-btn:visible, .tile:visible .tab-close:visible, .tile:visible .strip-btn:visible, .workspace-sidebar-button').all()){ const box=await target.boundingBox();assert.ok(box.width>=44 && box.height>=44,'tablet touch target '+JSON.stringify(box)); }
   // タブレットの狭い 1 パネル表示では、見出しのチップ『他 3 パネル』がパレットの『タブ』を開く
   await page.locator('.tile:visible').getByRole('button',{name:'他 3 パネル',exact:true}).click();
   const palette=page.getByRole('dialog',{name:'探す・操作',exact:true});
   assert.equal(await palette.getByRole('button',{name:'タブ',exact:true}).getAttribute('aria-pressed'),'true','the other-panels chip opens the palette on its tab scope');
   await palette.getByRole('combobox',{name:'探す・操作'}).fill('DGX Spark');
   await page.keyboard.press('Alt+Enter');
   assert.equal(await palette.locator('.sw-tab').count(),1,'tab search narrows to the DGX Spark tab');
   await page.keyboard.press('Escape');await palette.waitFor({state:'detached'});
   for(const list of await page.locator('.tile:visible .tablist').all()) assert.ok(await list.evaluate(el=>el.querySelector('.tab.active').getBoundingClientRect().left>=el.getBoundingClientRect().left-1),'selected tab keeps its leading label visible after resize');
   assert.equal(await page.evaluate(()=>localStorage.getItem('tw.layout')),layout,'responsive presentation preserves saved split tree');
  }
  if(phase==='after' && scene.name==='many-tabs'){
   const inputs=terminalInputs.length;
   const terminal=page.locator('.tile:visible .terminal-host').first();
   await terminal.click({button:'right',position:{x:80,y:80}});
   // 端末の右クリックはタブメニュー。tmux の構造を変える操作は『tmux ▸』の中にしまってあり、最初の段には出ない
   await page.getByRole('menuitem',{name:'tmux',exact:true}).waitFor();
   assert.equal(await page.getByRole('menuitem',{name:'tmux',exact:true}).getAttribute('aria-haspopup'),'menu');
   assert.equal(await page.getByRole('menuitem',{name:/ペイン|ウィンドウを閉じる|端末を終了|端末の名前/}).count(),0,'no tmux structural actions at the top of the terminal menu');
   assert.equal(await page.getByRole('menu').first().getAttribute('aria-label'),await page.locator('.tile:visible .tab.active .tab-name').first().textContent(),'the menu is titled with its tab');
   assert.equal(await page.evaluate(()=>{const first=document.querySelector('[role=menu] [role=menuitem]');return !!first && document.activeElement===first;}),true,'the terminal menu focuses its first item');
   await page.screenshot({path:join(out,'terminal-context-menu.png'),animations:'disabled'});
   await page.keyboard.press('Escape');
   await terminal.click({button:'right',modifiers:['Shift'],position:{x:80,y:80}});
   assert.equal(terminalInputs.length,inputs,'right click, including Shift, never sends tmux mouse reports');
   await page.keyboard.press('Escape');

   const tabWidths=await page.locator('.tab').evaluateAll(tabs=>tabs.map(tab=>tab.getBoundingClientRect().width));
   const first=page.locator('.tab[aria-selected=true]');await first.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(100);
   assert.equal(await page.locator('.tab[aria-selected=true]').getAttribute('data-tab-id'),'tab-local-2');
   assert.deepEqual(await page.locator('.tab').evaluateAll(tabs=>tabs.map(tab=>tab.getBoundingClientRect().width)),tabWidths,'tab selection preserves every tab width');
   assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-tab-id')),'tab-local-2');
   // ＋▾ の新規メニュー：入力先のデバイスは『端末』で開くので、『別のデバイスで ▸』には他のデバイスだけ
   await page.locator('.tile:visible').getByRole('button',{name:'新規メニュー',exact:true}).click();
   assert.equal(await page.getByRole('menu').first().getAttribute('aria-label'),'新規');
   assert.equal(await page.getByRole('menuitem',{name:/^端末/}).getAttribute('aria-keyshortcuts'),'t');
   assert.equal(await page.getByRole('menuitem',{name:'Claude を右に並べる',exact:true}).count(),1,'side placements are named in full for assistive tech');
   await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'新しい端末を右に並べる','→ moves into the row');
   await page.keyboard.press('ArrowDown');assert.match(await page.evaluate(()=>document.activeElement?.textContent),/^Claude/,'↓ moves between rows, not side buttons');
   await page.keyboard.press('End');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');
   assert.match(await page.evaluate(()=>document.activeElement?.textContent),/別のデバイスで/);
   await page.keyboard.press('ArrowRight');
   assert.equal(await page.getByRole('menuitem',{name:'DGX Spark',exact:true}).count(),1);
   assert.match(await page.evaluate(()=>document.activeElement?.textContent),/DGX Spark/);
   await page.keyboard.press('Escape');await page.keyboard.press('Escape');assert.equal(await page.getByRole('menu').count(),0);
   // Alt+Shift+T でも同じメニューが開き、先頭にフォーカスが当たる
   await page.locator('.tab[aria-selected=true]').focus();await page.keyboard.press('Alt+Shift+T');
   assert.equal(await page.getByRole('menu').first().getAttribute('aria-label'),'新規');
   assert.match(await page.evaluate(()=>document.activeElement?.textContent),/^端末/);
   await page.keyboard.press('Escape');assert.equal(await page.getByRole('menu').count(),0);
   // タブがあふれたら ‹ › が出る。× はアクティブなタブだけ
   assert.equal(await page.locator('.tile:visible .strip-scroll').count(),2,'overflowing tabs show scroll buttons');
   assert.equal(await page.locator('.tile:visible .tab:not(.active) .tab-close:visible').count(),0,'inactive tabs hide their close button');
   const close=page.locator('.tab[aria-selected=true] .tab-close');await close.focus();await page.keyboard.press('Enter');
   assert.equal(await page.locator('[data-tab-id=tab-local-2]').count(),0,'close button works with keyboard');
   // ワークスペースの名前の変更は、ワークスペースタブの右クリックメニューの『名前を変更…』から
   await page.locator('.desktop-tab').first().click({button:'right'});await page.getByRole('menuitem',{name:'名前を変更…',exact:true}).click();
   const prompt=page.getByRole('dialog',{name:'ワークスペースの名前を変更',exact:true});
   await prompt.getByRole('textbox').fill('開発用');await page.keyboard.press('Enter');
   assert.equal(await page.getByRole('tab',{name:'1 開発用',exact:true}).count(),1,'native prompt submits from keyboard');
  }
  if(phase==='after' && scene.name==='desktop-four'){
   const geometry=()=>page.locator('.tile').evaluateAll(tiles=>tiles.map(tile=>{
    const body=tile.querySelector('.tile-body').getBoundingClientRect();
    const header=tile.querySelector('.tabstrip').getBoundingClientRect();
    const canvas=tile.querySelector('canvas');
    return {id:tile.querySelector('[data-strip-leaf]').getAttribute('data-strip-leaf'),x:body.x,y:body.y,w:body.width,h:body.height,headerWidth:header.width,canvasWidth:canvas?.width,canvasHeight:canvas?.height};
   }));
   const before=await geometry();
   await page.locator('.tile').nth(2).getByRole('tab').first().click();await page.waitForTimeout(150);
   assert.deepEqual(await geometry(),before,'changing focused panel preserves content and canvas geometry');
   assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()),'#7aa2f7','device selection preserves Tokyo Night accent');
   if(process.env.CONNECTION_CHECK){
    assert.equal(activeTerminals,4);
    await page.getByRole('button',{name:'新しいワークスペース',exact:true}).click();
    await page.waitForTimeout(250);
    assert.equal(activeTerminals,4,'hidden desktop retains every terminal connection');
    await page.getByRole('tab',{name:'1 ワークスペース 1',exact:true}).click();
    await page.waitForTimeout(250);
    assert.equal(activeTerminals,4,'returning to desktop reuses its terminals');
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForTimeout(250);
    assert.equal(activeTerminals,4,'hidden browser tab retains terminal connections');
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForTimeout(250);
    assert.equal(activeTerminals,4,'visible browser tab reuses terminal connections');
    const count=terminalConnections;
    for(let i=0;i<3;i++){
     await togglePanel();
  await page.waitForTimeout(120);
     assert.equal(activeTerminals,4,'focused mode retains background panel connections');
     await togglePanel();
  await page.waitForTimeout(120);
     assert.equal(activeTerminals,4,'restoring split does not accumulate connections');
    }
    assert.equal(terminalConnections,count,'panel focus changes reuse all terminal connections');
    console.log('terminal connection lifecycle passed');
   }

  }
  if(phase==='after' && scene.name==='laptop-four'){
   const divider=page.locator('.divider.row').first();const box=await divider.boundingBox();
   await page.mouse.move(box.x+box.width/2,box.y+100);await page.mouse.down();await page.mouse.move(180,box.y+100);await page.mouse.up();await page.waitForTimeout(100);
   assert.equal(await page.locator('.tile:visible').count(),1,'narrow panel activates focus');
   await togglePanel();assert.equal(await page.locator('.tile:visible').count(),4,'can recover split without resizing viewport');
  }
  if(phase==='after' && scene.name==='focus-panel'){
   assert.equal(await page.locator('.tile:visible').count(),1);
   await page.keyboard.press('Alt+Enter');assert.equal(await page.locator('.tile:visible').count(),4);
  }
  if(phase==='after' && scene.name==='offline-panel'){
   const connections=terminalConnections;
   await page.locator('.panel-connection').getByRole('button',{name:'再接続',exact:true}).click();
   await page.waitForTimeout(100);assert.ok(terminalConnections>connections,'manual reconnect attempts target terminal');
  }
  await context.close();
 }
 let allResults=results;
 if(process.env.SCREENS && fs.existsSync(join(out,'metrics.json'))){const old=JSON.parse(fs.readFileSync(join(out,'metrics.json'),'utf8'));allResults=old.map(row=>results.find(next=>next.screen===row.screen)||row);}
 fs.writeFileSync(join(out,'metrics.json'),JSON.stringify(allResults,null,2)+'\n');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
