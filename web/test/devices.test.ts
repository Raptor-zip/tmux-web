import test from 'node:test';
import assert from 'node:assert/strict';
import { scoped, deviceOf, routeAction, scopeState } from '../src/devices';
import { allTabs, makeLeaf, makeTab, addTab, remapByName, pruneStale } from '../src/layout';
import type { TmuxState } from '../src/types';

test('identical tmux ids on different devices remain distinct; only target fields are routed', () => {
  assert.equal(scoped('local', '$1'), '$1'); assert.equal(scoped('spark', '$1'), 'spark~$1');
  assert.equal(deviceOf('spark~$1'), 'spark');
  const routed = routeAction({ target: 'spark~%1', name: 'local~%1', command: 'echo spark~%1', cwd: '/spark~home' });
  assert.equal(routed.device, 'spark');
  assert.deepEqual(routed.params, { target: '%1', name: 'local~%1', command: 'echo spark~%1', cwd: '/spark~home' });
  assert.throws(() => routeAction({ source: 'spark~@1', target: '@1' }), /またぐ/);
  assert.throws(() => routeAction({ targets: ['spark~@1', '@1'] }), /またぐ/);
  assert.equal(routeAction({ deviceId: 'spark', name: 'test' }).device, 'spark');
  const state = scopeState({ id: 'spark', name: 'Spark', local: false }, { sessions: [{ id: '$1' }], windows: [{ id: '@1', sessionId: '$1' }], panes: [{ id: '%1', windowId: '@1', sessionId: '$1' }] } as TmuxState);
  assert.equal(state.panes[0].sessionId, 'spark~$1'); assert.equal(state.windows[0].id, 'spark~@1');
});

test('same-named sessions remap within their device and disconnected devices keep their tabs', () => {
  const a = { ...makeTab('$1', '@1'), sessionName: 'dev', windowIndex: 0 };
  const b = { ...makeTab('spark~$1', 'spark~@1'), sessionName: 'dev', windowIndex: 0 };
  const leaf = makeLeaf(a);
  const tree = addTab(leaf, leaf.id, b);
  const src = { sessions: [{ id: '$2', name: 'dev' }, { id: 'spark~$3', name: 'dev' }], windows: [{ id: '@2', sessionId: '$2', name: 'bash', index: 0 }, { id: 'spark~@3', sessionId: 'spark~$3', name: 'bash', index: 0 }] };
  const mapped = remapByName(tree, src)!;
  assert.deepEqual(allTabs(mapped).map(t => t.tab.windowId), ['@2', 'spark~@3']);
  const offline = new Set(['spark']);
  const preserved = remapByName(tree, { sessions: src.sessions.slice(0, 1), windows: src.windows.slice(0, 1) }, offline)!;
  assert.equal(allTabs(preserved)[1].tab.windowId, 'spark~@1');
  assert.equal(allTabs(pruneStale(tree, new Set(['$1']), offline)!).length, 2);
  assert.equal(allTabs(pruneStale(tree, new Set(['$1']))!).length, 1);
});
