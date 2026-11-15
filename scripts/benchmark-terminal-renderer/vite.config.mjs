import { resolve } from 'node:path';
// リポジトリの node_modules にある xterm をそのまま使う
const nm = resolve(import.meta.dirname, '../../node_modules');
export default {
  root: import.meta.dirname,
  logLevel: 'error',
  resolve: { alias: [{ find: /^@xterm\/(.*)$/, replacement: nm + '/@xterm/$1' }] },
  build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true },
};
