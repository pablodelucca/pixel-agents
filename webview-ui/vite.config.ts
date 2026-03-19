import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
  },
  base: './',
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:3456',
        ws: true,
        rewriteWsOrigin: true,
      },
    },
  },
});
