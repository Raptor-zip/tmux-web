import test from 'node:test';
import assert from 'node:assert/strict';
import { commandName, classify } from '../src/inspect.js';

function inspect(rows) {
  const procs = new Map(), children = new Map();
  for (const [pid,ppid,name,stat='S+'] of rows) {
    procs.set(pid,{pid,ppid,name,stat,etimes:5});
    if(!children.has(ppid)) children.set(ppid,[]);
    children.get(ppid).push(pid);
  }
  return classify(1,procs,children,new Map());
}

test('recognizes runtime entry points without mistaking option values or inline code for agents', () => {
  assert.equal(commandName('node /opt/@openai/codex/bin/codex.js'),'codex');
  assert.equal(commandName('node --require /helper/claude.js /opt/codex.js'),'codex');
  assert.equal(commandName('node --import /helper/codex.js /opt/claude.js'),'claude');
  assert.equal(commandName('node -e claude'),'node');
  assert.equal(commandName('python3 -m aider'),'aider');
  assert.equal(commandName('claude --model codex'),'claude');
});

test('foreground Codex wins over background Claude regardless of process order', () => {
  for (const children of [[[2,1,'codex','S+'],[3,1,'claude','S']],[[3,1,'claude','S'],[2,1,'codex','S+']]]) {
    assert.equal(inspect([[1,0,'bash','Ss'],...children]).agent,'Codex');
  }
});

test('outer interactive agent wins over spawned agent tools in the same foreground group', () => {
  assert.equal(inspect([[1,0,'bash','Ss'],[2,1,'codex'],[3,2,'claude']]).agent,'Codex');
  assert.equal(inspect([[1,0,'bash','Ss'],[2,1,'claude'],[3,2,'codex']]).agent,'Claude');
});

test('zombies are ignored and foreground work is not mislabeled as a background agent', () => {
  assert.equal(inspect([[1,0,'bash','Ss+'],[2,1,'claude','Z']]).kind,'idle');
  assert.equal(inspect([[1,0,'bash','Ss'],[2,1,'claude','S'],[3,1,'vim','S+']]).agent,null);
  assert.equal(inspect([[1,0,'bash','Ss'],[2,1,'claude','S'],[3,1,'vim','S+']]).command,'vim');
});
