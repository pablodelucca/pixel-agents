import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';
import { canPlaceFurniture, paintTile } from '../src/office/editor/editorActions.js';

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

function registerFurnitureTestCatalog(): void {
  const sprite = [['#ffffff']];
  buildDynamicCatalog({
    catalog: [
      {
        id: 'chair',
        label: 'Chair',
        category: 'chairs',
        width: 1,
        height: 1,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
      },
      {
        id: 'wall-art',
        label: 'Wall Art',
        category: 'wall',
        width: 1,
        height: 1,
        footprintW: 1,
        footprintH: 1,
        isDesk: false,
        canPlaceOnWalls: true,
      },
    ],
    sprites: {
      chair: sprite,
      'wall-art': sprite,
    },
  });
}

test('normal furniture cannot overlap a glass wall tile', () => {
  registerFurnitureTestCatalog();
  const layout: OfficeLayout = {
    version: 1,
    cols: 1,
    rows: 1,
    tiles: [TileType.GLASS_WALL],
    furniture: [],
  };

  assert.equal(canPlaceFurniture(layout, 'chair', 0, 0), false);
});

test('wall-mounted furniture can attach to a glass wall tile', () => {
  registerFurnitureTestCatalog();
  const layout: OfficeLayout = {
    version: 1,
    cols: 1,
    rows: 1,
    tiles: [TileType.GLASS_WALL],
    furniture: [],
  };

  assert.equal(canPlaceFurniture(layout, 'wall-art', 0, 0), true);
});
