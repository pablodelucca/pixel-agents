import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const outDir = resolve(rootDir, 'dist');

mkdirSync(outDir, { recursive: true });

const sharedConfig = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
  external: ['electron', 'node-pty'],
};

await build({
  ...sharedConfig,
  format: 'cjs',
  entryPoints: [resolve(rootDir, 'src/main.ts')],
  outfile: resolve(outDir, 'main.cjs'),
});

await build({
  ...sharedConfig,
  format: 'cjs',
  entryPoints: [resolve(rootDir, 'src/preload.ts')],
  outfile: resolve(outDir, 'preload.cjs'),
  external: ['electron'],
});
