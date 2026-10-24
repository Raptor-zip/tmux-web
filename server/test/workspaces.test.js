import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createWorkspaces } from '../src/workspaces.js';

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-workspaces-'));
  const cleanup = [];
  t.after(async () => { for (const fn of cleanup) await fn(); await fs.rm(home, { recursive: true, force: true }); });
  const calls = [];
  const service = createWorkspaces({ home, runTmux: async args => { calls.push(args); return '$100\t@101\t%102\n'; } });
  return { home, service, calls, cleanup };
}

test('new projects create a repository and template, refuse overwrites and keep manual assets trackable', async t => {
  const { home, service } = await fixture(t);
  const result = await service.start({ mode: 'new', name: '日本語 project', template: 'node', agent: 'shell' });
  assert.equal(result.cwd, path.join(home, '日本語 project'));
  assert.equal((await fs.stat(path.join(result.cwd, '.git'))).isDirectory(), true);
  assert.equal(JSON.parse(await fs.readFile(path.join(result.cwd, 'package.json'), 'utf8')).private, true);
  assert.doesNotMatch(await fs.readFile(path.join(result.cwd, '.gitignore'), 'utf8'), /public/);
  await assert.rejects(service.start({ mode: 'new', name: '日本語 project' }), /同じ名前/);
  await assert.rejects(service.start({ mode: 'new', name: '../escape' }), /プロジェクト名/);
  await assert.rejects(service.start({ mode: 'existing', dir: '/etc' }), /ホーム配下/);
  await assert.rejects(service.start({ mode: 'existing', dir: home, agent: 'untrusted; command' }), /起動する/);
});

test('history resolves cwd from transcripts, deduplicates it and skips deleted, hidden and external directories', async t => {
  const { home, service } = await fixture(t);
  await fs.mkdir(path.join(home, 'notes'));
  await fs.mkdir(path.join(home, '.private'));
  for (const [name, cwd] of [['one',path.join(home,'notes')],['two',path.join(home,'notes')],['three','/etc'],['four',path.join(home,'.private')],['five',path.join(home,'deleted')]]) {
    const dir = path.join(home, '.claude', 'projects', name); await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, '11111111-1111-4111-8111-111111111111.jsonl'), JSON.stringify({type:'mode'})+'\n'+JSON.stringify({cwd})+'\n');
  }
  const recent = await service.recent();
  assert.equal(recent.length, 1); assert.equal(recent[0].cwd,path.join(home,'notes'));
  await assert.rejects(service.start({mode:'existing',dir:path.join(home,'notes'),resumeId:'not-an-id'}), /履歴/);
});

test('new and resumed Claude sessions use the shared tmux socket, preserve prompt arguments and leave a shell', async t => {
  try { execFileSync('tmux',['-V']); } catch { t.skip('tmux unavailable'); return; }
  const { home, cleanup } = await fixture(t);
  const socket = path.join(home,'socket');
  const bin=path.join(home,'bin');await fs.mkdir(bin);
  const log=path.join(home,'launch.json');
  await fs.writeFile(path.join(bin,'claude'), `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),fullscreen:process.env.CLAUDE_CODE_NO_FLICKER}));\n`,{mode:0o755});
  const env={...process.env,TMUX:'',PATH:`${bin}:${process.env.PATH}`};
  const tm=(args)=>execFileSync('tmux',['-S',socket,...args],{env,encoding:'utf8'}).trim();
  tm(['-f','/dev/null','new-session','-d','-s','qa']);tm(['set-option','-g','default-shell','/bin/sh']);tm(['set-environment','-g','PATH',env.PATH]);
  const oldPath=process.env.PATH;process.env.PATH=env.PATH;
  const previous=process.env.TMUX_WEB_SOCKET_PATH;process.env.TMUX_WEB_SOCKET_PATH=socket;
  cleanup.push(()=>{try{tm(['kill-server']);}catch{} process.env.PATH=oldPath; if(previous===undefined)delete process.env.TMUX_WEB_SOCKET_PATH;else process.env.TMUX_WEB_SOCKET_PATH=previous;});
  const service=createWorkspaces({home});
  const prompt="Handle 'quotes', $(literal) and\nmultiple lines";
  const created=await service.start({mode:'new',name:'notes',agent:'claude',prompt,remoteControl:true});
  for(let i=0;i<40;i++){try{await fs.access(log);break;}catch{}await new Promise(r=>setTimeout(r,25));}
  assert.deepEqual(JSON.parse(await fs.readFile(log,'utf8')),{args:['--remote-control','--',prompt],cwd:created.cwd,fullscreen:'1'});
  assert.equal(tm(['display-message','-p','-t',created.paneId,'#{pane_dead}']),'0');
  await fs.unlink(log);
  const resumeId='11111111-1111-4111-8111-111111111111';
  await service.start({mode:'existing',dir:created.cwd,resumeId,agent:'claude'});
  for(let i=0;i<40;i++){try{await fs.access(log);break;}catch{}await new Promise(r=>setTimeout(r,25));}
  assert.deepEqual(JSON.parse(await fs.readFile(log,'utf8')).args,['--resume',resumeId]);
});
