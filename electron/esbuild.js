const esbuild = require('esbuild');

const production = process.argv.includes('--production');

async function main() {
  // Build main process
  await esbuild.build({
    entryPoints: ['electron/main.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    outfile: 'dist-electron/main.js',
    external: ['electron'],
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    logLevel: 'info',
  });

  // Build preload script (separate bundle — runs in its own context)
  await esbuild.build({
    entryPoints: ['electron/preload.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    outfile: 'dist-electron/preload.js',
    external: ['electron'],
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    logLevel: 'info',
  });

  console.log('Electron build complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
