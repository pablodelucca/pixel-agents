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

test('wall instances choose sprite families by material while sharing mixed-wall connectivity', () => {
  const solidSprite = [['#111111']];
  const glassSprite = [['#22FFFFFF']];
  setWallSprites(
    [Array.from({ length: 16 }, () => solidSprite)],
    [Array.from({ length: 16 }, () => glassSprite)],
  );

  const instances = getWallInstances([[TileType.WALL, TileType.GLASS_WALL]]);

  assert.equal(instances.length, 2);
  assert.equal(instances[0]?.sprite, solidSprite);
  assert.equal(instances[1]?.sprite, glassSprite);
});
