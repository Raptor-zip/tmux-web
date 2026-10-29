// Presentation-only browser fixture: synthetic projects, terminals and errors.
// Does not contact real tmux APIs or read an existing browser profile.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {join,resolve}=require('node:path');
const fs=require('node:fs');
const http=require('node:http');
const express=require('express');
const assert=require('node:assert/strict');
const phase=process.argv[2]||'after';
const root=resolve(__dirname,'../..');
const out=process.env.TEST_OUTPUT||join(root,'artifacts/visual-feedback',phase);fs.mkdirSync(out,{recursive:true});
const now=1792597800000;
const deviceNames={local:'ThinkPad',spark:'DGX Spark'};
const projects=['atlas-web','orbital-navigation-console','atlas-web','billing-service','research-notes','design-system'];
function state(device){
 const sessions=[{id:'$1',name:'development',windows:12,created:now-3600000,activity:now,attached:1,group:null,groupSize:1,path:'/home/demo/projects'}];
 const windows=Array.from({length:12},(_,i)=>({id:'@'+(i+1),sessionId:'$1',sessionName:'development',index:i,name:['UIの調整','APIと認証を実装','テストとビルド','データの解析'][i%4],active:i===0,panes:1,layout:'',zoomed:false,activity:false,lastActivity:now,bell:false,width:120,height:32}));
 const panes=windows.map((w,i)=>({id:'%'+(i+1),sessionId:'$1',windowId:w.id,index:0,active:true,title:w.name,busy:i%3===0,command:'node',path:'/home/demo/projects/'+projects[i%projects.length],pid:1000+i,width:120,height:32,left:0,top:0,dead:false,inMode:false,proc:{kind:'agent',agent:i%2?'Claude':'Codex',command:i%2?'claude':'codex',ports:[],since:now-1800000},project:{root:'/home/demo/projects/'+projects[i%projects.length],name:projects[i%projects.length]}}));
 return{sessions,windows,panes,serverPid:device==='local'?501:502,ts:now,server:{version:'tmux 3.4',prefix:'C-b',socketName:'default',home:'/home/demo',device:{name:deviceNames[device],color:device==='local'?'#205683':'#266c5b',accent:device==='local'?'#70b8ff':'#69d3b5',fingerprint:device==='local'?'10000001':'20000002'}}};
}
function tab(n,device='local'){return{id:'tab-'+device+'-'+n,sessionId:device==='local'?'$1':'spark~$1',windowId:(device==='local'?'':'spark~')+'@'+n,sessionName:'development',windowIndex:n-1,windowName:state(device).windows[n-1].name};}
function leaf(n,device='local',extra=[]){const t=tab(n,device);return{type:'leaf',id:'panel-'+device+'-'+n,tabs:[t,...extra],activeId:t.id};}
function four(){return{type:'split',id:'split1',dir:'row',ratio:.25,a:leaf(1,'local',[tab(5)]),b:{type:'split',id:'split2',dir:'row',ratio:1/3,a:leaf(2),b:{type:'split',id:'split3',dir:'row',ratio:.5,a:leaf(1,'spark'),b:leaf(3)}}};}
const scenes=[
 {name:"desktop-controls",width:1280,height:800,sidebar:true,tree:leaf(1)},
 {name:"project-desktop",width:1280,height:800,sidebar:true,tree:leaf(1),action:"project"},
 {name:'desktop-four',width:1920,height:1080,tree:four()},
 {name:'laptop-four',width:1280,height:800,tree:four()},
 {name:'tablet-two',width:900,height:1024,touch:true,sidebar:true,tree:{type:'split',id:'split1',dir:'row',ratio:.5,a:leaf(1),b:leaf(1,'spark')}},
 {name:'mobile-panels',width:390,height:844,touch:true,tree:four()},
 {name:'mobile-landscape',width:740,height:390,touch:true,tree:four()},
 {name:'many-tabs',width:1100,height:800,tree:leaf(1,'local',Array.from({length:11},(_,i)=>tab(i+2)))},
 {name:'focus-panel',width:1280,height:800,tree:four(),action:'focus'},
 {name:'devices-modal',width:390,height:844,tree:leaf(1),action:'devices'},
 {name:'project-modal',width:390,height:640,sidebar:true,tree:leaf(1),action:'project'},
 {name:'desktop-modal',width:390,height:844,tree:leaf(1),action:'desktop'},
 {name:'files-modal',width:390,height:844,tree:leaf(1),action:'files'},
 {name:'offline-panel',width:900,height:700,tree:{type:'split',id:'split1',dir:'row',ratio:.5,a:leaf(1),b:leaf(1,'spark')},offline:true},
];
const output=(label)=>'\x1b[2J\x1b[H\x1b[?25l\x1b[1;36m'+label+'\x1b[0m\r\n\x1b[90m~/projects/atlas-web · feature/responsive-ui\x1b[0m\r\n\r\n\x1b[1mタスク：使いやすい端末ワークスペースを作る\x1b[0m\r\n\r\n  ✓ 接続先と作業名を確認\r\n  ✓ タブと分割の配置を保存\r\n  ✓ 狭い画面での操作を検証\r\n\r\n\x1b[1;32m実装の進捗\x1b[0m\r\n  狭いパネルでも作業名と状態が分かる構成にします。\r\n  デバイスごとの端末を同じ画面で操作できます。\r\n\r\n  src/components/Workspace.tsx    +24 −12\r\n  src/styles.css                 +48 −20\r\n\r\n\x1b[32m  18 tests passed\x1b[0m\r\n\x1b[90m  次にブラウザで表示を確認します。\x1b[0m\r\n\r\n────────────────────────────────────────\r\n\x1b[1m› 次の作業を入力…\x1b[0m\r\n';
(async()=>{
 const app=express();app.use(express.static((process.env.STATIC_ROOT||join(root,'web/dist'))));app.get('*',(_q,r)=>r.sendFile(join(process.env.STATIC_ROOT||join(root,'web/dist'),'index.html')));
 const server=http.createServer(app);await new Promise(r=>server.listen(17656,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/home/somak/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',args:['--no-sandbox']});
 const results=[];
 try{
 for(const scene of scenes.filter(scene=>!process.env.SCREENS || process.env.SCREENS.split(',').includes(scene.name))){
  const context=await browser.newContext({viewport:{width:scene.width,height:scene.height},deviceScaleFactor:1,hasTouch:!!scene.touch,reducedMotion:'reduce',locale:'ja-JP',serviceWorkers:'block'});
  await context.addInitScript(({tree,sidebar,now,keepStorage})=>{Date.now=()=>now;if(keepStorage && sessionStorage.getItem('desktop-transfer-initialized'))return;sessionStorage.setItem('desktop-transfer-initialized','1');localStorage.setItem('tw.layout',JSON.stringify(tree));localStorage.setItem('tw.sidebar',JSON.stringify(!!sidebar));localStorage.setItem('tw.serverPid','"local:501|spark:502"');localStorage.setItem('tw.focusedLeaf',JSON.stringify('panel-local-1'));},{tree:scene.tree,sidebar:scene.sidebar,now,keepStorage:!!process.env.DESKTOP_TRANSFER_CHECK});
  const page=await context.newPage();if(process.env.CONNECTION_CHECK)page.screenshot=async()=>{};const errors=[];let terminalConnections=0;let activeTerminals=0;const terminalInputs=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),remote=url.pathname.includes('/devices/spark/proxy/'),path=remote?url.pathname.split('/proxy')[1]:url.pathname;
   let body={};let status=200;
   if(path==='/api/devices')body={devices:[{id:'local',name:'ThinkPad',local:true},{id:'spark',name:'DGX Spark',local:false,url:'https://spark.example.ts.net:8443'}]};
   else if(path==='/api/state'){body=state(remote?'spark':'local');if(remote&&scene.offline){body={error:'デバイスに接続できません'};status=502;}}
   else if(path==='/api/approvals')body={pending:null,secure:true};
   else if(path==='/api/projects/recent')body={projects:[]};
   else if(path==='/api/desktop/status')body={available:false,error:'デスクトップに接続できません。デバイスのログイン状態を確認してください。',viewers:0};
   else if(path==='/api/files')body={root:'/home/demo/projects/atlas-web',path:'',items:[{name:'src',path:'src',directory:true,size:0,modified:now,mime:''},{name:'responsive-workspace-review.md',path:'responsive-workspace-review.md',directory:false,size:2840,modified:now,mime:'text/plain'},{name:'package.json',path:'package.json',directory:false,size:960,modified:now,mime:'text/plain'}]};
   else if(path==='/api/keys')body={keys:[]};
   else if(path==='/api/action')body={ok:true,result:null};
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.routeWebSocket(/\/ws\//,ws=>{
   const url=new URL(ws.url()),remote=url.pathname.includes('/devices/spark/');
   if(url.pathname.endsWith('/events')){if(remote&&scene.offline){ws.close();return;}const send=()=>ws.send(JSON.stringify({type:'state',...state(remote?'spark':'local')}));send();ws.onMessage(send);}
   else if(url.pathname.endsWith('/terminal')){terminalConnections++;activeTerminals++;ws.onClose(()=>{activeTerminals--;});if(remote&&scene.offline){ws.send(JSON.stringify({type:'error',message:'接続先がオフラインです。再接続しています。'}));ws.close();return;}ws.send(JSON.stringify({type:'ready',mode:'mirror'}));ws.send(Buffer.from('\x1b[?1000h\x1b[?1006h'+output(deviceNames[remote?'spark':'local'])));ws.onMessage(message=>{try{const data=JSON.parse(String(message));if(data.type==='input')terminalInputs.push(data.data);}catch{}});}
  });
  const checkStateConnection=process.env.STATE_CONNECTION_CHECK && scene.name==='desktop-four' ? await require('./state-connection.cjs')(page,{state,terminals:()=>activeTerminals}) : null;
  await page.goto('http://127.0.0.1:17656/');await page.locator('.xterm').first().waitFor();await page.waitForTimeout(2800);
  if(checkStateConnection) await checkStateConnection();
  const togglePanel=async()=>{await page.locator('.tile.focused').getByRole('button',{name:'パネルの操作',exact:true}).click();await page.getByRole('menuitem',{name:/^このパネルを広げる \/ 元に戻す/}).click();};
  if(process.env.ATTACHMENT_CHECK && scene.name==='mobile-panels') await require('./attachments.cjs')(page, terminalInputs);
  if(scene.action==='focus')await page.keyboard.press('Alt+Enter');
  if(scene.action==='devices')await page.locator('footer .device-name').click();
  if(scene.action==='project')await page.getByRole('button',{name:'＋ プロジェクトを作る',exact:true}).click();
  if(scene.action==='desktop')await page.getByRole('button',{name:'デバイスの画面を見る',exact:true}).click();
  if(scene.action==='files')await page.getByRole('button',{name:'作業フォルダーを開く',exact:true}).click();
  await page.waitForTimeout(120);await page.screenshot({path:join(out,scene.name+'.png'),animations:'disabled'});
  const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,visiblePanels:[...document.querySelectorAll('.tile')].filter(el=>!!el.getClientRects().length).map(el=>({width:Math.round(el.getBoundingClientRect().width),headerWidth:el.querySelector('.tablist')?.clientWidth||0})),dialogs:[...document.querySelectorAll('[role="dialog"],dialog[open]')].map(el=>({label:el.getAttribute('aria-label'),width:Math.round(el.getBoundingClientRect().width)}))}));
  results.push({screen:scene.name,width:scene.width,height:scene.height,...metrics,errors});
  if(phase==='after'){assert.deepEqual(errors,[],scene.name+' runtime errors');assert.equal(metrics.overflow,false,scene.name+' horizontal page overflow');}
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
    await page.getByTitle('文字サイズを変える',{exact:true}).click();
    await page.getByRole('menuitem',{name:/最小にする/}).click();
    assert.equal(await page.getByTitle('文字サイズを変える',{exact:true}).textContent(),'6px');
    await page.getByTitle('行間を変える',{exact:true}).click();
    await page.getByRole('menuitem',{name:/詰める/}).click();
    assert.equal(await page.getByTitle('行間を変える',{exact:true}).textContent(),'行間 1.14');
    await page.getByTitle('行間を変える',{exact:true}).click();
    await page.getByRole('menuitem',{name:/最小にする/}).click();
    assert.equal(await page.getByTitle('行間を変える',{exact:true}).textContent(),'行間 1.00');
    await page.waitForTimeout(150);
   }
   if(scene.action==='project'){
    const select=page.getByRole('combobox',{name:'テンプレート',exact:true});
    await select.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
    assert.equal(await select.inputValue(),'node','select retains native keyboard behavior');
   }
   assert.deepEqual(errors,[],'no runtime errors after form and font interactions');
  }

  if(process.env.DESKTOP_TRANSFER_CHECK) await require('./desktop-transfer.cjs')(page, errors);
  console.log(scene.name,JSON.stringify(metrics));
  if(phase==='after' && scene.name==='mobile-panels'){
   assert.equal(activeTerminals,1,'only the visible mobile panel attaches');
   const layout=await page.evaluate(()=>localStorage.getItem('tw.layout'));
   await page.getByRole('button',{name:'このパネルの2タブを一覧で見る',exact:true}).click();
   await page.getByRole('textbox',{name:'タブを検索'}).fill('DGX Spark');
   await page.keyboard.press('Alt+Enter');
   await page.screenshot({path:join(out,'panel-overview.png'),animations:'disabled'});
   await page.locator('.overview-tab').click();
   await page.waitForTimeout(100);
   assert.equal(await page.locator('.tile:visible [role=tab][aria-selected=true]').getAttribute('data-tab-id'),'tab-spark-1');
   assert.equal(await page.locator('.tile:visible').count(),1);
   await page.setViewportSize({width:1920,height:1080});await page.waitForTimeout(150);
   assert.equal(await page.locator('.tile:visible').count(),4,'restores split after resize');
   assert.equal(activeTerminals,4,'only visible split panels retain websocket connections');
   await page.setViewportSize({width:900,height:1024});await page.waitForTimeout(150);
   for(const target of await page.locator('.editorbar-actions .icon-btn:visible, .tile:visible .tab-close, .tile:visible .tab-menu:visible, .tile:visible .strip-btn, .workspace-sidebar-button').all()){ const box=await target.boundingBox();assert.ok(box.width>=44 && box.height>=44,'tablet touch target '+JSON.stringify(box)); }
   for(const list of await page.locator('.tile:visible .tablist').all()) assert.ok(await list.evaluate(el=>el.querySelector('.tab.active').getBoundingClientRect().left>=el.getBoundingClientRect().left-1),'selected tab keeps its leading label visible after resize');
   assert.equal(await page.evaluate(()=>localStorage.getItem('tw.layout')),layout,'responsive presentation preserves saved split tree');
  }
  if(phase==='after' && scene.name==='many-tabs'){
   const inputs=terminalInputs.length;
   const terminal=page.locator('.tile:visible .terminal-host').first();
   await terminal.click({button:'right',position:{x:80,y:80}});
   await page.getByRole('menuitem',{name:/^新しい端末を右に並べる/}).waitFor();
   assert.equal(await page.getByRole('menuitem',{name:/tmux|ペイン|ウィンドウを閉じる/}).count(),0,'no tmux structural actions in terminal menu');
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
   await page.locator('.tile:visible').getByRole('button',{name:'新しい端末をタブで開く',exact:true}).click();
   assert.equal(await page.getByRole('menuitem',{name:'DGX Spark で端末を開く'}).count(),1);
   await page.keyboard.press('End');assert.match(await page.evaluate(()=>document.activeElement?.textContent),/DGX Spark/);
   await page.keyboard.press('Escape');assert.equal(await page.getByRole('menu').count(),0);
   const close=page.locator('.tab[aria-selected=true] .tab-close');await close.focus();await page.keyboard.press('Enter');
   assert.equal(await page.locator('[data-tab-id=tab-local-2]').count(),0,'close button works with keyboard');
   await page.getByRole('button',{name:'現在のデスクトップの名前を変更',exact:true}).click();
   const prompt=page.getByRole('dialog',{name:'デスクトップの名前を変更',exact:true});
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
    await page.getByRole('button',{name:'デスクトップを追加',exact:true}).click();
    await page.waitForTimeout(250);
    assert.equal(activeTerminals,0,'hidden desktop releases every terminal connection');
    await page.getByRole('tab',{name:'1 デスクトップ1',exact:true}).click();
    await page.waitForTimeout(250);
    assert.equal(activeTerminals,4,'returning to desktop reconnects its visible terminals');
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForTimeout(250);
    assert.equal(activeTerminals,0,'hidden browser tab releases terminal connections');
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForTimeout(250);
    assert.equal(activeTerminals,4,'visible browser tab restores terminal connections');
    const count=terminalConnections;
    for(let i=0;i<3;i++){
     await togglePanel();
     await page.waitForTimeout(120);
     assert.equal(activeTerminals,1,'focused panel is the only attached terminal');
     await togglePanel();
     await page.waitForTimeout(120);
     assert.equal(activeTerminals,4,'restoring split does not accumulate connections');
    }
    assert.equal(terminalConnections,count+9,'only newly visible panels reconnect');
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
