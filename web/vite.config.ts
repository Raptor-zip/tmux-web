import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BACKEND = process.env.TMUX_WEB_BACKEND || 'http://127.0.0.1:7654';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  server: {
    port: 5173,
    proxy: {
      '/icon': { target: BACKEND, changeOrigin: false },
      '/manifest.webmanifest': { target: BACKEND, changeOrigin: false },
      '/files': { target: BACKEND, changeOrigin: false },
      '/api': { target: BACKEND, changeOrigin: false },
      '/ws': { target: BACKEND.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
  },
});
