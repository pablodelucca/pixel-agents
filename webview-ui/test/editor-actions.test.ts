import test from 'node:test';
import assert from 'node:assert/strict';

import type { ColorValue } from '../src/components/ui/types.js';
import { paintCarpet } from '../src/office/editor/editorActions.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

function createLayout(): OfficeLayout {
  return {
    version: 1,
    cols: 2,
    rows: 2,
    tiles: [TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1],
    furniture: [],
  };
}

test('paintCarpet returns the same layout when repainting the same carpet tile', () => {
  const color: ColorValue = { h: 10, s: 20, b: 0, c: 0 };
  const accentColor: ColorValue = { h: 25, s: 30, b: 5, c: 0 };
  const initial = createLayout();
  const painted = paintCarpet(initial, 0, 0, 1, color, accentColor, 7);
  const repainted = paintCarpet(painted, 0, 0, 1, color, accentColor, 7);

  assert.notStrictEqual(painted, initial);
  assert.strictEqual(repainted, painted);
});

test('paintCarpet returns a new layout when carpet settings change', () => {
  const initial = createLayout();
  const painted = paintCarpet(initial, 0, 0, 1, { h: 0, s: 0, b: 0, c: 0 }, undefined, 1);
  const updated = paintCarpet(painted, 0, 0, 1, { h: 30, s: 25, b: 5, c: 0 }, undefined, 1);

  assert.notStrictEqual(updated, painted);
  assert.deepEqual(updated.carpetTiles?.[0], {
    variant: 1,
    order: 1,
    color: { h: 30, s: 25, b: 5, c: 0 },
  });
});
