import { build } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// 既存の Vite で TypeScript テストを一時ディレクトリへ束ね、Node のテストで実行する。
const outDir = await mkdtemp(join(tmpdir(), 'tmux-web-tests-'));
try {
  await build({ configFile: false, logLevel: 'error', build: {
    outDir, lib: { entry: 'test/windows.test.ts', formats: ['es'], fileName: () => 'windows.test.mjs' },
    rollupOptions: { external: id => id.startsWith('node:') },
  } });
  const result = spawnSync(process.execPath, ['--test', join(outDir, 'windows.test.mjs')], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { await rm(outDir, { recursive: true, force: true }); }
