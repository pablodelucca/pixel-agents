import * as fs from 'fs';
import * as path from 'path';

import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

// ── Manifest flattening (mirrors src/assetLoader.ts flattenManifest) ──────────

interface ManifestNode {
  type: 'asset' | 'group';
  id?: string;
  file?: string;
  width?: number;
  height?: number;
  footprintW?: number;
  footprintH?: number;
  orientation?: string;
  state?: string;
  frame?: number;
  mirrorSide?: boolean;
  groupType?: string;
  rotationScheme?: string;
  members?: ManifestNode[];
}

interface InheritedProps {
  groupId: string;
  name: string;
  category: string;
  canPlaceOnWalls: boolean;
  canPlaceOnSurfaces: boolean;
  backgroundTiles: number;
  orientation?: string;
  state?: string;
  rotationScheme?: string;
  animationGroup?: string;
}

interface CatalogEntry {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  furniturePath: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  groupId?: string;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

function flattenNode(
  node: ManifestNode,
  inherited: InheritedProps,
  folderName: string,
): CatalogEntry[] {
  if (node.type === 'asset') {
    const orientation = node.orientation ?? inherited.orientation;
    const state = node.state ?? inherited.state;
    return [
      {
        id: node.id!,
        name: inherited.name,
        label: inherited.name,
        category: inherited.category,
        file: node.file!,
        furniturePath: `furniture/${folderName}/${node.file}`,
        width: node.width!,
        height: node.height!,
        footprintW: node.footprintW!,
        footprintH: node.footprintH!,
        isDesk: inherited.category === 'desks',
        canPlaceOnWalls: inherited.canPlaceOnWalls,
        canPlaceOnSurfaces: inherited.canPlaceOnSurfaces,
        backgroundTiles: inherited.backgroundTiles,
        groupId: inherited.groupId,
        ...(orientation ? { orientation } : {}),
        ...(state ? { state } : {}),
        ...(node.mirrorSide ? { mirrorSide: true } : {}),
        ...(inherited.rotationScheme ? { rotationScheme: inherited.rotationScheme } : {}),
        ...(inherited.animationGroup ? { animationGroup: inherited.animationGroup } : {}),
        ...(node.frame !== undefined ? { frame: node.frame } : {}),
      },
    ];
  }

  const results: CatalogEntry[] = [];
  for (const member of node.members ?? []) {
    const child: InheritedProps = { ...inherited };
    if (node.groupType === 'rotation' && node.rotationScheme)
      child.rotationScheme = node.rotationScheme;
    if (node.groupType === 'state') {
      if (node.orientation) child.orientation = node.orientation;
      if (node.state) child.state = node.state;
    }
    if (node.groupType === 'animation') {
      const orient = node.orientation ?? inherited.orientation ?? '';
      const st = node.state ?? inherited.state ?? '';
      child.animationGroup = `${inherited.groupId}_${orient}_${st}`.toUpperCase();
      if (node.state) child.state = node.state;
    }
    if (node.orientation && !child.orientation) child.orientation = node.orientation;
    results.push(...flattenNode(member, child, folderName));
  }
  return results;
}

// ── Asset data generators ─────────────────────────────────────────────────────

function buildFurnitureCatalog(assetsDir: string): CatalogEntry[] {
  const furnitureDir = path.join(assetsDir, 'furniture');
  if (!fs.existsSync(furnitureDir)) return [];

  const catalog: CatalogEntry[] = [];
  const dirs = fs
    .readdirSync(furnitureDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const folderName of dirs) {
    const manifestPath = path.join(furnitureDir, folderName, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const inherited: InheritedProps = {
        groupId: manifest.id,
        name: manifest.name,
        category: manifest.category,
        canPlaceOnWalls: manifest.canPlaceOnWalls,
        canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
        backgroundTiles: manifest.backgroundTiles,
        ...(manifest.rotationScheme ? { rotationScheme: manifest.rotationScheme } : {}),
      };

      if (manifest.type === 'asset') {
        catalog.push({
          id: manifest.id,
          name: manifest.name,
          label: manifest.name,
          category: manifest.category,
          file: manifest.file ?? `${manifest.id}.png`,
          furniturePath: `furniture/${folderName}/${manifest.file ?? `${manifest.id}.png`}`,
          width: manifest.width,
          height: manifest.height,
          footprintW: manifest.footprintW,
          footprintH: manifest.footprintH,
          isDesk: manifest.category === 'desks',
          canPlaceOnWalls: manifest.canPlaceOnWalls,
          canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
          backgroundTiles: manifest.backgroundTiles,
          groupId: manifest.id,
        });
      } else {
        catalog.push(...flattenNode(manifest, inherited, folderName));
      }
    } catch {
      // skip malformed manifests
    }
  }
  return catalog;
}

function buildAssetIndex(assetsDir: string) {
  function listSorted(subdir: string, pattern: RegExp): string[] {
    const dir = path.join(assetsDir, subdir);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => pattern.test(f))
      .sort((a, b) => {
        const na = parseInt(/(\d+)/.exec(a)?.[1] ?? '0', 10);
        const nb = parseInt(/(\d+)/.exec(b)?.[1] ?? '0', 10);
        return na - nb;
      });
  }

  let defaultLayout: string | null = null;
  let bestRev = 0;
  if (fs.existsSync(assetsDir)) {
    for (const f of fs.readdirSync(assetsDir)) {
      const m = /^default-layout-(\d+)\.json$/.exec(f);
      if (m) {
        const rev = parseInt(m[1], 10);
        if (rev > bestRev) {
          bestRev = rev;
          defaultLayout = f;
        }
      }
    }
    if (!defaultLayout && fs.existsSync(path.join(assetsDir, 'default-layout.json'))) {
      defaultLayout = 'default-layout.json';
    }
  }

  return {
    floors: listSorted('floors', /^floor_\d+\.png$/i),
    walls: listSorted('walls', /^wall_\d+\.png$/i),
    characters: listSorted('characters', /^char_\d+\.png$/i),
    defaultLayout,
  };
}

// ── Vite plugin ───────────────────────────────────────────────────────────────

function browserMockAssetsPlugin(isBrowserMockBuild: boolean, outDir: string): Plugin {
  const assetsDir = path.resolve(__dirname, 'public/assets');
  const distAssetsDir = path.resolve(__dirname, outDir, 'assets');

  return {
    name: 'browser-mock-assets',
    // Dev server: serve the JSON files dynamically via middleware
    configureServer(server) {
      server.middlewares.use('/assets/furniture-catalog.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(buildFurnitureCatalog(assetsDir)));
      });
      server.middlewares.use('/assets/asset-index.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(buildAssetIndex(assetsDir)));
      });
    },
    // build:browser: write the JSON files into <outDir>/assets/ alongside
    // the PNGs that Vite copies from public/
    closeBundle() {
      if (!isBrowserMockBuild) return;
      fs.mkdirSync(distAssetsDir, { recursive: true });
      fs.writeFileSync(
        path.join(distAssetsDir, 'furniture-catalog.json'),
        JSON.stringify(buildFurnitureCatalog(assetsDir)),
      );
      fs.writeFileSync(
        path.join(distAssetsDir, 'asset-index.json'),
        JSON.stringify(buildAssetIndex(assetsDir)),
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
