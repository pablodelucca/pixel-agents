import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EditorState } from '../src/office/editor/editorState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import { getBlockedTiles } from '../src/office/layout/layoutSerializer.js';
import { isWalkable } from '../src/office/layout/tileMap.js';
import type { OfficeLayout } from '../src/office/types.js';
import { EditTool, TileType } from '../src/office/types.js';
import { canPlaceFurniture, paintTile } from '../src/office/editor/editorActions.js';
import {
  applyEyedropperTileToEditorStateForTest,
  applyWallPaintToLayoutForTest,
  getTileTypeForWallMaterial,
} from '../src/hooks/useEditorActions.js';

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

test('wall material selection maps to the expected tile type', () => {
  assert.equal(getTileTypeForWallMaterial('solid'), TileType.WALL);
  assert.equal(getTileTypeForWallMaterial('glass'), TileType.GLASS_WALL);
});

test('wall paint uses the selected glass material and wall color', () => {
  const editorState = new EditorState();
  const wallColor = { h: 200, s: 40, b: 10, c: 5, colorize: true };
  editorState.selectedWallMaterial = 'glass';
  editorState.wallColor = wallColor;

  const nextLayout = applyWallPaintToLayoutForTest(createLayout(), 0, 1, editorState);

  assert.equal(nextLayout.tiles[2], TileType.GLASS_WALL);
  assert.deepEqual(nextLayout.tileColors?.[2], wallColor);
});

test('eyedropper selects glass wall material from a glass wall tile', () => {
  const editorState = new EditorState();

  applyEyedropperTileToEditorStateForTest(editorState, TileType.GLASS_WALL);

  assert.equal(editorState.selectedWallMaterial, 'glass');
  assert.equal(editorState.activeTool, EditTool.WALL_PAINT);
});

function registerFurnitureTestCatalog(): void {
  const sprite = [['#ffffff']];
  const tallWallSprite = [['#ffffff'], ['#dddddd']];
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
      {
        id: 'wall-banner',
        label: 'Wall Banner',
        category: 'wall',
        width: 1,
        height: 2,
        footprintW: 1,
        footprintH: 2,
        isDesk: false,
        canPlaceOnWalls: true,
      },
    ],
    sprites: {
      chair: sprite,
      'wall-art': sprite,
      'wall-banner': tallWallSprite,
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

test('normal furniture can overlap the non-support rows of wall-mounted items', () => {
  registerFurnitureTestCatalog();
  const layout: OfficeLayout = {
    version: 1,
    cols: 1,
    rows: 2,
    tiles: [TileType.FLOOR_1, TileType.GLASS_WALL],
    furniture: [{ uid: 'banner-1', type: 'wall-banner', col: 0, row: 0 }],
  };

  assert.equal(canPlaceFurniture(layout, 'chair', 0, 0), true);
});

test('wall-mounted non-support rows do not block walking on floor tiles', () => {
  registerFurnitureTestCatalog();
  const layout: OfficeLayout = {
    version: 1,
    cols: 1,
    rows: 2,
    tiles: [TileType.FLOOR_1, TileType.GLASS_WALL],
    furniture: [{ uid: 'banner-1', type: 'wall-banner', col: 0, row: 0 }],
  };
  const blockedTiles = getBlockedTiles(layout.furniture);
  const tileMap = [[TileType.FLOOR_1], [TileType.GLASS_WALL]];

  assert.equal(blockedTiles.has('0,0'), false);
  assert.equal(blockedTiles.has('0,1'), true);
  assert.equal(isWalkable(0, 0, tileMap, blockedTiles), true);
});
