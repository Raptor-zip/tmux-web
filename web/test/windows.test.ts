import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWindowViews, paneCommand, windowName, windowTitle } from '../src/windows';
import { windowStatus } from '../src/status';
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

test('Claude after Codex is also labeled correctly and unknown processes do not overwrite custom names', () => {
  const claude = { ...codex, title: 'Codex', command: 'claude', proc: { ...codex.proc!, agent: 'Claude', command: 'claude' } } as Pane;
  assert.equal(windowTitle({ ...win, name: 'codex' }, claude), 'Claude');
  assert.equal(windowName({ ...win, name: 'node' }, claude), 'Claude');
  assert.equal(windowName({ ...win, name: 'custom' }, { ...codex, proc: null }), 'custom');
});
