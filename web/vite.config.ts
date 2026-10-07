import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BACKEND = process.env.TMUX_WEB_BACKEND || 'http://127.0.0.1:7654';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/icon': { target: BACKEND, changeOrigin: true },
      '/manifest.webmanifest': { target: BACKEND, changeOrigin: true },
      '/files': { target: BACKEND, changeOrigin: true },
      '/api': { target: BACKEND, changeOrigin: true },
      '/ws': { target: BACKEND.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
