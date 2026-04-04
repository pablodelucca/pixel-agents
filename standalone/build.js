import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WEBVIEW_SRC = '/tmp/pixel-agents/dist/webview';
const ASSETS_SRC = '/tmp/pixel-agents/dist/assets';
const OUT = join(__dirname, 'dist');
const PUBLIC = join(OUT, 'public');

// Clean start
mkdirSync(PUBLIC, { recursive: true });

// 1. Copy webview build output
if (existsSync(WEBVIEW_SRC)) {
  cpSync(WEBVIEW_SRC, PUBLIC, { recursive: true });
  console.log('Copied webview → dist/public/');
} else {
  console.warn('WARN: webview source not found at', WEBVIEW_SRC);
}

// 2. Copy office assets (furniture, characters, floors, walls)
if (existsSync(ASSETS_SRC)) {
  cpSync(ASSETS_SRC, join(PUBLIC, 'assets'), { recursive: true });
  console.log('Copied assets → dist/public/assets/');
} else {
  console.warn('WARN: assets source not found at', ASSETS_SRC);
}

// 3. Inject ws-adapter.js script tag into index.html
const indexPath = join(PUBLIC, 'index.html');
if (existsSync(indexPath)) {
  let html = readFileSync(indexPath, 'utf-8');
  const scriptTag = '<script src="/ws-adapter.js"></script>';

  if (!html.includes(scriptTag)) {
    html = html.replace('<head>', '<head>\n    ' + scriptTag);
    writeFileSync(indexPath, html);
    console.log('Injected ws-adapter.js script tag into index.html');
  } else {
    console.log('ws-adapter.js script tag already present in index.html');
  }
} else {
  console.warn('WARN: index.html not found — skipping script injection');
}

// 4. Copy ws-adapter.js to dist/public/
const adapterSrc = join(__dirname, 'public', 'ws-adapter.js');
if (existsSync(adapterSrc)) {
  cpSync(adapterSrc, join(PUBLIC, 'ws-adapter.js'));
  console.log('Copied ws-adapter.js → dist/public/');
}

// 5. Copy server.js and scanner.js to dist/
for (const file of ['server.js', 'scanner.js']) {
  const src = join(__dirname, 'src', file);
  if (existsSync(src)) {
    cpSync(src, join(OUT, file));
    console.log(`Copied ${file} → dist/`);
  } else {
    console.warn(`WARN: src/${file} not found — skipping`);
  }
}

console.log('Build complete.');
