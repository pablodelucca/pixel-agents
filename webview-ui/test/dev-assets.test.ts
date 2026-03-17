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

import type { AssetIndex } from '../../shared/assets/types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function startDevServer(base: string, port: number): Promise<ViteDevServer> {
  const server = await createServer({
    configFile: path.resolve(root, 'vite.config.ts'),
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

async function fetchAssetIndex(baseUrl: string, basePath: string): Promise<AssetIndex> {
  // Mirror what browserMock.ts does: BASE_URL + 'assets/asset-index.json'
  const url = `${baseUrl}${basePath}assets/asset-index.json`;
  const res = await fetch(url);
  assert.equal(res.status, 200, `GET ${url} returned ${res.status.toString()}`);
  return res.json() as Promise<AssetIndex>;
}

test('asset-index.json is accessible without a subpath (base: /)', async () => {
  const server = await startDevServer('/', 5174);
  try {
    const index = await fetchAssetIndex(serverUrl(server), '/');
    assert.ok(Array.isArray(index.floors), 'floors should be an array');
    assert.ok(Array.isArray(index.walls), 'walls should be an array');
    assert.ok(Array.isArray(index.characters), 'characters should be an array');
    assert.ok('defaultLayout' in index, 'defaultLayout field should exist');
  } finally {
    await server.close();
  }
});

test('asset-index.json is accessible with a subpath (base: /sub/)', async () => {
  const server = await startDevServer('/sub/', 5175);
  try {
    const index = await fetchAssetIndex(serverUrl(server), '/sub/');
    assert.ok(Array.isArray(index.floors), 'floors should be an array');
    assert.ok(Array.isArray(index.walls), 'walls should be an array');
    assert.ok(Array.isArray(index.characters), 'characters should be an array');
    assert.ok('defaultLayout' in index, 'defaultLayout field should exist');
  } finally {
    await server.close();
  }
});
