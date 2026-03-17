import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/server.js',
  sourcemap: true,
  banner: {
    js: `
import { createRequire } from 'module';
import { fileURLToPath as ___fileURLToPath } from 'url';
import { dirname as ___dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = ___fileURLToPath(import.meta.url);
const __dirname = ___dirname(__filename);
`,
  },
  external: [],
});

console.log('Build complete: dist/server.js');
