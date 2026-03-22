/**
 * Integration tests for the Vite dev server asset endpoints.
 *
 * Verifies that `browserMock.ts` can reach all asset JSON endpoints both at
 * the root path (base: '/') and under a subpath (base: '/sub/'), matching
 * how `import.meta.env.BASE_URL` constructs fetch URLs at runtime.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ViteDevServer } from 'vite';
import { createServer } from 'vite';

import type { AssetIndex, CatalogEntry } from '../../shared/assets/types.ts';

interface DecodedWallSets {
  solidSets: string[][][][];
  glassSets: string[][][][];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function startDevServer(base: string, port: number): Promise<ViteDevServer> {
  const server = await createServer({
    configFile: path.resolve(root, 'vite.config.ts'),
    root,
    base,
    server: { port, strictPort: false },
    logLevel: 'silent',
  });
  await server.listen();
  return server;
}

function serverUrl(server: ViteDevServer): string {
  const addr = server.httpServer?.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 5173;
  return `http://localhost:${port}`;
}

function assetUrl(baseUrl: string, basePath: string, relPath: string): string {
  return `${baseUrl}${basePath}assets/${relPath}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  assert.equal(res.status, 200, `GET ${url} returned ${res.status.toString()}`);
  return res.json() as Promise<T>;
}

async function assertUrlOk(url: string): Promise<void> {
  const res = await fetch(url);
  assert.equal(res.status, 200, `GET ${url} returned ${res.status.toString()}`);
}

function indexedPath(kind: 'characters' | 'floors' | 'walls', relPath: string): string {
  return relPath.startsWith(`${kind}/`) ? relPath : `${kind}/${relPath}`;
}

async function verifyAssetUrls(baseUrl: string, basePath: string): Promise<void> {
  const assetIndex = await fetchJson<AssetIndex>(assetUrl(baseUrl, basePath, 'asset-index.json'));
  const catalog = await fetchJson<CatalogEntry[]>(
    assetUrl(baseUrl, basePath, 'furniture-catalog.json'),
  );
  const decodedWalls = await fetchJson<DecodedWallSets>(
    assetUrl(baseUrl, basePath, 'decoded/walls.json'),
  );

  await assertUrlOk(assetUrl(baseUrl, basePath, 'decoded/characters.json'));
  await assertUrlOk(assetUrl(baseUrl, basePath, 'decoded/floors.json'));
  await assertUrlOk(assetUrl(baseUrl, basePath, 'decoded/furniture.json'));

  assert.ok(assetIndex.floors.length > 0, 'floors index should not be empty');
  assert.ok(assetIndex.solidWalls.length > 0, 'solidWalls index should not be empty');
  assert.ok(assetIndex.glassWalls.length > 0, 'glassWalls index should not be empty');
  assert.ok(assetIndex.characters.length > 0, 'characters index should not be empty');
  assert.ok(catalog.length > 0, 'furniture catalog should not be empty');
  assert.ok(decodedWalls.solidSets.length > 0, 'decoded solid wall sets should not be empty');
  assert.ok(decodedWalls.glassSets.length > 0, 'decoded glass wall sets should not be empty');

  await assertUrlOk(assetUrl(baseUrl, basePath, indexedPath('floors', assetIndex.floors[0])));
  await assertUrlOk(assetUrl(baseUrl, basePath, indexedPath('walls', assetIndex.solidWalls[0])));
  await assertUrlOk(assetUrl(baseUrl, basePath, indexedPath('walls', assetIndex.glassWalls[0])));
  await assertUrlOk(
    assetUrl(baseUrl, basePath, indexedPath('characters', assetIndex.characters[0])),
  );
  await assertUrlOk(assetUrl(baseUrl, basePath, catalog[0].furniturePath));

  if (assetIndex.defaultLayout) {
    await assertUrlOk(assetUrl(baseUrl, basePath, assetIndex.defaultLayout));
  }
}

test('asset-index.json is accessible without a subpath (base: /)', async () => {
  const server = await startDevServer('/', 5174);
  try {
    await verifyAssetUrls(serverUrl(server), '/');
  } finally {
    await server.close();
  }
});

test('asset-index.json is accessible with a subpath (base: /sub/)', async () => {
  const server = await startDevServer('/sub/', 5175);
  try {
    await verifyAssetUrls(serverUrl(server), '/sub/');
  } finally {
    await server.close();
  }
});
