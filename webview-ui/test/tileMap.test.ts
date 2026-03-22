import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isWalkable } from '../src/office/layout/tileMap.js';
import { TileType } from '../src/office/types.js';

test('glass wall tiles are not walkable', () => {
  const tileMap = [[TileType.GLASS_WALL]];

  assert.equal(isWalkable(0, 0, tileMap, new Set()), false);
});
