import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';
import { paintTile } from '../src/office/editor/editorActions.js';

function createLayout(): OfficeLayout {
  return {
    version: 1,
    cols: 2,
    rows: 2,
    tiles: [TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1],
    furniture: [],
  };
}

test('painting a glass wall writes GLASS_WALL without adding a floor color', () => {
  const layout = createLayout();

  const nextLayout = paintTile(layout, 1, 0, TileType.GLASS_WALL);

  assert.equal(nextLayout.tiles[1], TileType.GLASS_WALL);
  assert.equal(nextLayout.tileColors?.[1] ?? null, null);
  assert.equal(layout.tiles[1], TileType.FLOOR_1);
});
