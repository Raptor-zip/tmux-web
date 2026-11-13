import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWindowViews, groupProjectWindows, paneCommand, windowName, windowTitle } from '../src/windows';
import { TERMINAL_GRACE_MS, windowStatus } from '../src/status';
import type { Pane, TmuxWindow } from '../src/types';

const win = { id: '@1', sessionId: '$1', name: 'claude', index: 1, lastActivity: 0 } as TmuxWindow;
const codex = { id: '%1', windowId: '@1', active: true, index: 1, title: 'Claude Code', command: 'node', path: '/demo', busy: false, dead: false,
  proc: { kind: 'agent', agent: 'Codex', command: 'codex', ports: [], since: 0 } } as Pane;

test('Codex overrides stale Claude names across title, location and command', () => {
  const view = buildWindowViews([win], [codex], '/home/demo', 0).get(win.id)!;
  assert.equal(view.primary, 'Codex');
  assert.equal(view.where, '1:Codex');
  assert.equal(view.command, 'Codex');
  assert.equal(view.status.agent, 'Codex');
  assert.deepEqual(view.status.chips, ['Codex']);
  assert.equal(paneCommand(codex), 'Codex');
  assert.equal(windowName(win, codex), 'Codex');
});

test('active Codex pane wins over inactive Claude and both agents remain visible', () => {
  const claude = { ...codex, id: '%2', active: false, index: 0, title: 'Claude Code',
    proc: { ...codex.proc!, agent: 'Claude', command: 'claude' } } as Pane;
  const status = windowStatus(win, [claude, codex], 0);
  assert.equal(status.agent, 'Codex');
  assert.deepEqual(status.chips, ['Codex', 'Claude']);
  const view = buildWindowViews([win], [claude, codex], '/home/demo', 0).get(win.id)!;
  assert.equal(view.lead?.id, codex.id);
  assert.equal(view.primary, 'Codex');
});

test('custom window names and task titles are preserved', () => {
  assert.equal(windowName({ ...win, name: 'release-check' }, codex), 'release-check');
  assert.equal(windowTitle(win, { ...codex, title: 'Claude API の連携を修正' }), 'Claude API の連携を修正');
  assert.equal(windowTitle(win, { ...codex, title: 'Fix Claude integration' }), 'Fix Claude integration');
  assert.equal(windowTitle(win, { ...codex, title: 'Codex — implementation' }), 'Codex — implementation');
});

test('shell after agent exit does not inherit the agent label', () => {
  const shell = { ...codex, command: 'bash', proc: { ...codex.proc!, kind: 'idle', agent: null, command: '' } } as Pane;
  assert.equal(windowName(win, shell), 'bash');
  assert.equal(windowTitle(win, shell), 'bash');
});

test('shell terminals stay visible for five minutes, then become idle', () => {
  const shell = { ...codex, command: 'bash', proc: { ...codex.proc!, kind: 'idle', agent: null, command: '' } } as Pane;
  const lastActivity = 1_000_000;
  const recent = { ...win, lastActivity };
  for (const elapsed of [0, TERMINAL_GRACE_MS - 1]) {
    const status = windowStatus(recent, [shell], lastActivity + elapsed);
    assert.equal(status.kind, 'run');
    assert.equal(status.label, 'ターミナル');
    assert.deepEqual(status.chips, []);
  }
  assert.equal(windowStatus(recent, [shell], lastActivity + TERMINAL_GRACE_MS).kind, 'idle');
  // 新たな出力があれば、再び5分間表示する。
  assert.equal(windowStatus({ ...recent, lastActivity: lastActivity + TERMINAL_GRACE_MS }, [shell], lastActivity + TERMINAL_GRACE_MS + 1).kind, 'run');
  assert.equal(windowStatus(win, [shell], lastActivity).kind, 'idle');
  assert.equal(windowStatus(recent, [{ ...shell, dead: true }], lastActivity).kind, 'idle');
  assert.equal(windowStatus(recent, [codex], lastActivity).kind, 'waiting');
});

test('Claude after Codex is also labeled correctly and unknown processes do not overwrite custom names', () => {
  const claude = { ...codex, title: 'Codex', command: 'claude', proc: { ...codex.proc!, agent: 'Claude', command: 'claude' } } as Pane;
  assert.equal(windowTitle({ ...win, name: 'codex' }, claude), 'Claude');
  assert.equal(windowName({ ...win, name: 'node' }, claude), 'Claude');
  assert.equal(windowName({ ...win, name: 'custom' }, { ...codex, proc: null }), 'custom');
});

test('project rows fold identical agent task titles and prefer the active or already open terminal', () => {
  const first = { ...win, panes: 1 };
  const second = { ...first, id: '@2', index: 2 };
  const panes = [codex, { ...codex, id: '%2', windowId: '@2' }].map(pane => ({ ...pane, title: '3Dシューティングとレースを試作して | int-ball2-game' }));
  const views = buildWindowViews([first, second], panes, '/home/demo', 0);
  const folded = groupProjectWindows([first, second], views, '@2', new Set(['@1', '@2']));
  assert.equal(folded.length, 1);
  assert.equal(folded[0].window.id, '@2');
  assert.deepEqual(folded[0].others.map(win => win.id), ['@1']);
  assert.equal(groupProjectWindows([first, second], views, null, new Set(['@2']))[0].window.id, '@2');
  assert.equal(groupProjectWindows([first, second], views, null, new Set())[0].window.id, '@1');
  assert.equal(views.size, 2, 'folding never removes either terminal from the underlying views');
});

test('similar prefixes, different agents, directories, devices and multi-pane windows remain separate', () => {
  const first = { ...win, panes: 1 };
  const task = { ...codex, title: '同じ作業のタイトル' };
  for (const [second, other] of [
    [{ ...first, id: '@2' }, { ...task, id: '%2', windowId: '@2', title: '同じ作業のタイトル（別の依頼）' }],
    [{ ...first, id: '@2' }, { ...task, id: '%2', windowId: '@2', proc: { ...task.proc!, agent: 'Claude' } }],
    [{ ...first, id: '@2' }, { ...task, id: '%2', windowId: '@2', path: '/other' }],
    [{ ...first, id: 'spark~@2' }, { ...task, id: 'spark~%2', windowId: 'spark~@2' }],
    [{ ...first, id: '@2', panes: 2 }, { ...task, id: '%2', windowId: '@2' }],
  ] as [TmuxWindow, Pane][]) {
    const views = buildWindowViews([first, second], [task, other], '/home/demo', 0);
    assert.equal(groupProjectWindows([first, second], views, null, new Set()).length, 2);
  }
});

test('generic CLI names and shell titles do not hide unrelated terminals', () => {
  const windows = [{ ...win, panes: 1 }, { ...win, id: '@2', panes: 1 }];
  for (const pane of [codex, { ...codex, title: '同じシェルのタイトル', proc: { ...codex.proc!, kind: 'idle', agent: null } } as Pane]) {
    const views = buildWindowViews(windows, [pane, { ...pane, id: '%2', windowId: '@2' }], '/home/demo', 0);
    assert.equal(groupProjectWindows(windows, views, null, new Set()).length, 2);
  }
});

test('linked windows appear once in project rows even through independent sessions', () => {
  const linked = { ...win, sessionId: '$2', sessionName: 'other' };
  const views = buildWindowViews([win, linked], [codex], '/home/demo', 0);
  const rows = groupProjectWindows([win, linked], views, null, new Set());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].others.length, 0);
});
