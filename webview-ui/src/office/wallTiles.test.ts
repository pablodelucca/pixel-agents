import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TileType } from './types.js';
import { buildWallMaskForTest } from './wallTiles.js';

test('mixed solid and glass wall neighbors share the same connectivity mask', () => {
  const tileMap = [
    [TileType.VOID, TileType.WALL, TileType.VOID],
    [TileType.GLASS_WALL, TileType.GLASS_WALL, TileType.WALL],
    [TileType.VOID, TileType.GLASS_WALL, TileType.VOID],
  ];

  assert.equal(buildWallMaskForTest(1, 1, tileMap), 15);
});
