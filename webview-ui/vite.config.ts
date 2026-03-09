import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const isElectron = process.env.BUILD_TARGET === 'electron';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
  },
  base: './',
  resolve: isElectron
    ? {
        alias: [
          {
            find: /^.*vscodeApi\.js$/,
            replacement: path.resolve(__dirname, 'src/electronApi.ts'),
          },
        ],
      }
    : {},
});
