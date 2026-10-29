import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { connectTerminal, TERMINAL_MAX_PAYLOAD } from '../src/terminal.js';

const waitFor = async check => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.fail('terminal protocol did not reach the expected state');
};

test('real WebSocket input stays on requested windows across startup, renumbering, reconnect and selection failure', {
  timeout: 15000, skip: spawnSync('tmux', ['-V']).status !== 0,
}, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-terminal-protocol-'));
  const socket = path.join(temp, 'socket');
  const oldPath = process.env.TMUX_WEB_SOCKET_PATH;
  const oldName = process.env.TMUX_WEB_SOCKET_NAME;
  process.env.TMUX_WEB_SOCKET_PATH = socket;
  delete process.env.TMUX_WEB_SOCKET_NAME;
  const run = args => execFileSync('tmux', ['-S', socket, ...args], { env: { ...process.env, TMUX: '' }, encoding: 'utf8' }).trim();
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', maxPayload: TERMINAL_MAX_PAYLOAD });
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.terminate();
    for (const client of wss.clients) client.terminate();
    await new Promise(resolve => wss.close(resolve));
    try { run(['kill-server']); } catch {}
    if (oldPath === undefined) delete process.env.TMUX_WEB_SOCKET_PATH; else process.env.TMUX_WEB_SOCKET_PATH = oldPath;
    if (oldName === undefined) delete process.env.TMUX_WEB_SOCKET_NAME; else process.env.TMUX_WEB_SOCKET_NAME = oldName;
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const script = path.join(temp, 'record.cjs');
  await fs.writeFile(script, `const fs = require('node:fs');
const file = process.argv[2];
process.stdin.setRawMode(true);
process.stdin.on('data', data => fs.appendFileSync(file, data));
fs.writeFileSync(file + '.ready', 'ready');
`);
  const first = path.join(temp, 'first-input');
  const second = path.join(temp, 'second-input');
  run(['-f', '/dev/null', 'new-session', '-d', '-s', 'protocol', '-n', 'first', '-c', temp, process.execPath, script, first]);
  run(['new-window', '-d', '-t', 'protocol', '-n', 'second', process.execPath, script, second]);
  await waitFor(async () => { try { await fs.access(first + '.ready'); await fs.access(second + '.ready'); return true; } catch { return false; } });
  const firstWindow = run(['display-message', '-p', '-t', 'protocol:first', '#{window_id}']);
  const secondWindow = run(['display-message', '-p', '-t', 'protocol:second', '#{window_id}']);
  const secondIndex = Number(run(['display-message', '-p', '-t', 'protocol:second', '#{window_index}']));
  wss.on('connection', (ws, request) => { void connectTerminal(ws, request, () => {}); });
  if (!wss.address()) await once(wss, 'listening');
  const open = (windowId = firstWindow) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wss.address().port}/ws/terminal?session=protocol&window=${windowId}`);
    clients.push(ws);
    const messages = [];
    const ready = new Promise((resolve, reject) => {
      ws.on('error', reject);
      ws.on('message', (raw, binary) => {
        if (!binary) { const message = JSON.parse(raw.toString()); messages.push(message); if (message.type === 'ready') resolve(); }
      });
    });
    return { ws, ready, messages };
  };
  const { ws, ready } = open();
  await once(ws, 'open');
  ws.send('null');
  ws.send('{not JSON');
  ws.send(JSON.stringify({ type: 'input', data: 'startup' }));
  await ready;
  ws.send(JSON.stringify({ type: 'selectWindow', index: secondIndex }));
  ws.send(Buffer.from('日本語-after-switch'));
  await waitFor(async () => { try { return (await fs.readFile(second, 'utf8')) === '日本語-after-switch'; } catch { return false; } });
  assert.equal(await fs.readFile(first, 'utf8'), 'startup', 'switch input never reaches the previous window');
  const closed = once(ws, 'close');
  ws.send(Buffer.alloc(TERMINAL_MAX_PAYLOAD + 1));
  const [code] = await closed;
  assert.equal(code, 1009);
  await waitFor(() => !run(['list-sessions', '-F', '#{session_name}']).includes('webmux-'));
  for (const target of ['protocol:first', 'protocol:second']) assert.equal(run(['display-message', '-p', '-t', target, '#{pane_dead}']), '0');
  const next = open();
  await next.ready;
  next.ws.send(Buffer.from('-reconnected'));
  await waitFor(async () => (await fs.readFile(first, 'utf8')) === 'startup-reconnected');
  // The stale index is now owned by another live process. The stable ID must
  // still select the user's original window instead of that replacement.
  const replacement = path.join(temp, 'replacement-input');
  run(['move-window', '-s', 'protocol:second', '-t', 'protocol:30']);
  run(['new-window', '-d', '-t', `protocol:${secondIndex}`, '-n', 'replacement', process.execPath, script, replacement]);
  await waitFor(async () => { try { await fs.access(replacement + '.ready'); return true; } catch { return false; } });
  next.ws.send(JSON.stringify({ type: 'selectWindow', index: secondIndex, windowId: secondWindow, requestId: 7 }));
  next.ws.send(Buffer.from('-after-renumber'));
  await waitFor(async () => (await fs.readFile(second, 'utf8')) === '日本語-after-switch-after-renumber'
    || await fs.readFile(replacement, 'utf8').then(() => true, () => false));
  assert.equal(await fs.readFile(second, 'utf8'), '日本語-after-switch-after-renumber', 'a reused index cannot redirect input away from the requested ID');
  assert.equal(await fs.readFile(replacement, 'utf8').catch(() => ''), '');
  await waitFor(() => next.messages.some(message => message.type === 'selectedWindow' && message.requestId === 7));
  assert.equal(next.messages.find(message => message.type === 'selectedWindow' && message.requestId === 7).windowId, secondWindow);
  assert.equal(next.messages.find(message => message.type === 'ready').selectionAck, true);
  let failedCode = null;
  next.ws.on('close', code => { failedCode = code; });
  next.ws.send(JSON.stringify({ type: 'selectWindow', index: 999999 }));
  next.ws.send(Buffer.from('-must-not-reach-previous-window'));
  await waitFor(async () => failedCode !== null || (await fs.readFile(second, 'utf8')) !== '日本語-after-switch-after-renumber');
  assert.equal(await fs.readFile(first, 'utf8'), 'startup-reconnected', 'a failed switch never replays pending input to the old window');
  assert.equal(await fs.readFile(second, 'utf8'), '日本語-after-switch-after-renumber', 'failed selection discards input for the previously active window');
  await waitFor(() => failedCode !== null);
  assert.equal(failedCode, 1011);
  for (const target of ['protocol:first', 'protocol:second']) assert.equal(run(['display-message', '-p', '-t', target, '#{pane_dead}']), '0');
  await waitFor(() => !run(['list-sessions', '-F', '#{session_name}']).includes('webmux-'));
  const missing = open(); await missing.ready;
  let missingCode = null; missing.ws.on('close', code => { missingCode = code; });
  missing.ws.send(JSON.stringify({ type: 'selectWindow', index: 0, windowId: '@999999', requestId: 8 }));
  missing.ws.send(Buffer.from('-must-not-fallback-to-index'));
  await waitFor(async () => missingCode !== null || (await fs.readFile(first, 'utf8')) !== 'startup-reconnected');
  assert.equal(await fs.readFile(first, 'utf8'), 'startup-reconnected', 'an unavailable ID never falls back to a valid index');
  await waitFor(() => missingCode !== null);
  assert.equal(missingCode, 1011);
  assert.equal(missing.messages.some(message => message.type === 'selectedWindow'), false);
  await waitFor(() => !run(['list-sessions', '-F', '#{session_name}']).includes('webmux-'));
  const unavailable = open('@999999');
  let unavailableCode = null; unavailable.ws.on('close', code => { unavailableCode = code; });
  await once(unavailable.ws, 'open');
  unavailable.ws.send(Buffer.from('-must-not-reach-an-initial-fallback'));
  await waitFor(() => unavailableCode !== null);
  assert.equal(unavailableCode, 1011);
  assert.equal(unavailable.messages.some(message => message.type === 'ready'), false);
  assert.equal(await fs.readFile(first, 'utf8'), 'startup-reconnected');
  assert.equal(await fs.readFile(second, 'utf8'), '日本語-after-switch-after-renumber');
  assert.equal(await fs.readFile(replacement, 'utf8').catch(() => ''), '');
  await waitFor(() => !run(['list-sessions', '-F', '#{session_name}']).includes('webmux-'));
});
