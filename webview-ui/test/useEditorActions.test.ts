import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isEditorWallTile } from '../src/hooks/useEditorActions.js';
import { TileType } from '../src/office/types.js';

test('editor wall interaction helper treats glass walls as walls', () => {
  assert.equal(isEditorWallTile(TileType.GLASS_WALL), true);
  assert.equal(isEditorWallTile(TileType.WALL), true);
  assert.equal(isEditorWallTile(TileType.FLOOR_1), false);
  assert.equal(isEditorWallTile(undefined), false);
});
