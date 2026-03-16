import react from '@vitejs/plugin-react';
import * as fs from 'fs';
import * as path from 'path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

import { buildAssetIndex, buildFurnitureCatalog } from '../shared/assets/build.ts';
import {
  decodeAllCharacters,
  decodeAllFloors,
  decodeAllFurniture,
  decodeAllWalls,
} from '../shared/assets/decode.ts';

// ── Decoded asset cache (invalidated on file change) ─────────────────────────

interface DecodedCache {
  characters: ReturnType<typeof decodeAllCharacters> | null;
  floors: ReturnType<typeof decodeAllFloors> | null;
  walls: ReturnType<typeof decodeAllWalls> | null;
  furniture: ReturnType<typeof decodeAllFurniture> | null;
}

// ── Vite plugin ───────────────────────────────────────────────────────────────

function browserMockAssetsPlugin(isBrowserMockBuild: boolean, outDir: string): Plugin {
  const assetsDir = path.resolve(__dirname, 'public/assets');
  const distAssetsDir = path.resolve(__dirname, outDir, 'assets');

  const cache: DecodedCache = { characters: null, floors: null, walls: null, furniture: null };

  function clearCache(): void {
    cache.characters = null;
    cache.floors = null;
    cache.walls = null;
    cache.furniture = null;
  }

  return {
    name: 'browser-mock-assets',
    // Dev server: serve JSON files dynamically via middleware
    configureServer(server) {
      // Catalog & index (existing)
      server.middlewares.use('/assets/furniture-catalog.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(buildFurnitureCatalog(assetsDir)));
      });
      server.middlewares.use('/assets/asset-index.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(buildAssetIndex(assetsDir)));
      });

      // Pre-decoded sprites (new — eliminates browser-side PNG decoding)
      server.middlewares.use('/assets/decoded/characters.json', (_req, res) => {
        cache.characters ??= decodeAllCharacters(assetsDir);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.characters));
      });
      server.middlewares.use('/assets/decoded/floors.json', (_req, res) => {
        cache.floors ??= decodeAllFloors(assetsDir);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.floors));
      });
      server.middlewares.use('/assets/decoded/walls.json', (_req, res) => {
        cache.walls ??= decodeAllWalls(assetsDir);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.walls));
      });
      server.middlewares.use('/assets/decoded/furniture.json', (_req, res) => {
        cache.furniture ??= decodeAllFurniture(assetsDir, buildFurnitureCatalog(assetsDir));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(cache.furniture));
      });

      // Hot-reload on asset file changes (PNGs, manifests, layouts)
      server.watcher.add(assetsDir);
      server.watcher.on('change', (file) => {
        if (file.startsWith(assetsDir)) {
          console.log(`[browser-mock-assets] Asset changed: ${path.relative(assetsDir, file)}`);
          clearCache();
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
    // build:browser: write JSON files into <outDir>/assets/ alongside
    // the PNGs that Vite copies from public/
    closeBundle() {
      if (!isBrowserMockBuild) return;
      fs.mkdirSync(distAssetsDir, { recursive: true });

      // Catalog & index
      const catalog = buildFurnitureCatalog(assetsDir);
      fs.writeFileSync(path.join(distAssetsDir, 'furniture-catalog.json'), JSON.stringify(catalog));
      fs.writeFileSync(
        path.join(distAssetsDir, 'asset-index.json'),
        JSON.stringify(buildAssetIndex(assetsDir)),
      );

      // Pre-decoded sprites
      const decodedDir = path.join(distAssetsDir, 'decoded');
      fs.mkdirSync(decodedDir, { recursive: true });
      fs.writeFileSync(
        path.join(decodedDir, 'characters.json'),
        JSON.stringify(decodeAllCharacters(assetsDir)),
      );
      fs.writeFileSync(
        path.join(decodedDir, 'floors.json'),
        JSON.stringify(decodeAllFloors(assetsDir)),
      );
      fs.writeFileSync(
        path.join(decodedDir, 'walls.json'),
        JSON.stringify(decodeAllWalls(assetsDir)),
      );
      fs.writeFileSync(
        path.join(decodedDir, 'furniture.json'),
        JSON.stringify(decodeAllFurniture(assetsDir, catalog)),
      );

      console.log('[browser-mock-assets] Wrote JSON files to', distAssetsDir);
    },
  };
}

export default defineConfig(({ mode }) => {
  const isBrowserMock = mode === 'browser-mock';
  // browser-mock builds output to dist/browser/ so the app is served at
  // root (/). Vite copies public/ into outDir, so all PNGs end up at
  // /assets/... alongside the JSON files written by closeBundle.
  const outDir = isBrowserMock ? '../dist/browser' : '../dist/webview';
  return {
    plugins: [react(), browserMockAssetsPlugin(isBrowserMock, outDir)],
    define: {
      __BROWSER_MOCK__: JSON.stringify(isBrowserMock),
    },
    build: {
      outDir,
      emptyOutDir: true,
    },
    base: isBrowserMock ? '/' : './',
  };
});
