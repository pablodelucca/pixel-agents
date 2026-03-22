import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TileType } from '../src/office/types.js';
import { buildWallMaskForTest, getWallInstances, setWallSprites } from '../src/office/wallTiles.js';

test('mixed solid and glass wall neighbors share the same connectivity mask', () => {
  const tileMap = [
    [TileType.VOID, TileType.WALL, TileType.VOID],
    [TileType.GLASS_WALL, TileType.GLASS_WALL, TileType.WALL],
    [TileType.VOID, TileType.GLASS_WALL, TileType.VOID],
  ];

  assert.equal(buildWallMaskForTest(1, 1, tileMap), 15);
});

test('wall instances render glass walls with the solid wall fallback for runtime safety', () => {
  const sprite = [['#ffffff']];
  setWallSprites([Array.from({ length: 16 }, () => sprite)]);

  const instances = getWallInstances([[TileType.GLASS_WALL]]);

  assert.equal(instances.length, 1);
  assert.equal(instances[0]?.sprite, sprite);
});
