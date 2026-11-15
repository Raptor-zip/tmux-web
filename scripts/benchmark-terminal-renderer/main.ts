import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
const q = new URLSearchParams(location.search);
const renderer = q.get('r') || 'dom';
const n = Number(q.get('n') || 4);
const grid = document.getElementById('grid')!;
grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
const terms: Terminal[] = [];
for (let i = 0; i < n; i++) {
  const el = document.createElement('div'); el.className = 'cell'; grid.appendChild(el);
  const t = new Terminal({ fontFamily: 'monospace', fontSize: 14, lineHeight: 1, scrollback: 0, allowProposedApi: true });
  const fit = new FitAddon(); t.loadAddon(fit); const u = new Unicode11Addon(); t.loadAddon(u); t.unicode.activeVersion = '11';
  t.open(el); if (renderer === 'webgl') t.loadAddon(new WebglAddon()); fit.fit(); terms.push(t);
}
const enc = new TextEncoder();
const colors = [31, 32, 33, 34, 35, 36, 90, 37];
function floodChunk(seed: number) { let s = ''; for (let l = 0; l < 200; l++) { const c = colors[(l + seed) % 8]; s += `\x1b[${c}m[${seed}:${l}] src/components/Workspace.tsx\x1b[0m compiled 日本語の出力 ${'x'.repeat((l * 7 + seed) % 60)}\r\n`; } return enc.encode(s); }
function tuiFrame(t: Terminal, f: number) { let s = '\x1b[H'; for (let r = 0; r < t.rows; r++) { s += `\x1b[${r + 1};1H\x1b[${colors[(r + f) % 8]};4${(r + f) % 8}m`; s += (`${f} row ${r} 進捗 ` + '█▓▒░'.repeat(20)).slice(0, t.cols - 1); s += '\x1b[0m'; } return enc.encode(s); }
const writeAsync = (t: Terminal, d: Uint8Array) => new Promise<void>(r => t.write(d, r));
const raf = () => new Promise<number>(r => requestAnimationFrame(r));
let longTasks = 0, longTaskMs = 0;
new PerformanceObserver(l => { for (const e of l.getEntries()) { longTasks++; longTaskMs += e.duration; } }).observe({ type: 'longtask', buffered: false });
(window as any).run = async () => {
  await raf(); await raf();
  // A: flood — 4MB-ish per terminal, interleaved like many websocket messages
  longTasks = 0; longTaskMs = 0;
  let t0 = performance.now();
  const chunks = 150;
  for (let c = 0; c < chunks; c++) await Promise.all(terms.map((t, i) => writeAsync(t, floodChunk(c + i))));
  await raf(); await raf();
  const flood = { ms: performance.now() - t0, longTasks, longTaskMs };
  // B: TUI redraw at a ~60fps feed for 3s; measure rAF frame intervals
  longTasks = 0; longTaskMs = 0;
  const intervals: number[] = []; let last = performance.now(), running = true;
  (async () => { while (running) { const now = await raf(); intervals.push(now - last); last = now; } })();
  t0 = performance.now(); let f = 0;
  await new Promise<void>(done => { const tick = () => { if (performance.now() - t0 > 3000) return done(); terms.forEach(t => t.write(tuiFrame(t, f))); f++; setTimeout(tick, 16); }; tick(); });
  running = false; await raf();
  intervals.sort((a, b) => a - b);
  const pct = (p: number) => intervals[Math.floor(intervals.length * p)];
  const tui = { frames: intervals.length, fedFrames: f, p50: pct(0.5), p95: pct(0.95), max: intervals.at(-1), over33ms: intervals.filter(x => x > 33).length, longTasks, longTaskMs };
  return { renderer, n, cols: terms[0].cols, rows: terms[0].rows, flood, tui, canvases: document.querySelectorAll('canvas').length };
};
(window as any).ready = true;
