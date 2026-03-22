import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TileType } from '../src/office/types.js';
import { clearColorizeCache } from '../src/office/colorize.js';
import {
  buildWallMaskForTest,
  getColorizedWallSprite,
  getWallInstances,
  setWallSprites,
} from '../src/office/wallTiles.js';

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

test('colorized solid and glass walls do not reuse the same cached sprite', () => {
  clearColorizeCache();

  const solidSprite = [['#202020']];
  const glassSprite = [['#d0d0d0AA']];
  const color = { h: 200, s: 75, b: 0, c: 0, colorize: true } as const;

  setWallSprites(
    [Array.from({ length: 16 }, () => solidSprite)],
    [Array.from({ length: 16 }, () => glassSprite)],
  );

  const solidWall = getColorizedWallSprite(0, 0, [[TileType.WALL]], color);
  const glassWall = getColorizedWallSprite(0, 0, [[TileType.GLASS_WALL]], color);

  assert.ok(solidWall);
  assert.ok(glassWall);
  assert.notStrictEqual(glassWall.sprite, solidWall.sprite);
  assert.notDeepEqual(glassWall.sprite, solidWall.sprite);
});
