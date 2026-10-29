import { build } from 'vite';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// 既存の Vite で TypeScript テストを一時ディレクトリへ束ね、Node のテストで実行する。
const outDir = await mkdtemp(join(tmpdir(), 'tmux-web-tests-'));
try {
  const entries = Object.fromEntries((await readdir('test')).filter(name => name.endsWith('.test.ts'))
    .map(name => [name.slice(0, -8), `test/${name}`]));
  await build({ configFile: false, logLevel: 'error', build: {
    outDir, lib: { entry: entries, formats: ['es'], fileName: (_format, entry) => `${entry}.test.mjs` },
    rollupOptions: { external: id => id.startsWith('node:') },
  } });
  const result = spawnSync(process.execPath, ['--test', ...Object.keys(entries).map(name => join(outDir, `${name}.test.mjs`))], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { await rm(outDir, { recursive: true, force: true }); }
