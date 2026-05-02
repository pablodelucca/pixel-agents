import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorState } from '../src/office/editor/editorState.js';
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

test('EditorState only returns one undo snapshot during a carpet stroke', () => {
  const editorState = new EditorState();
  const beforeStroke = createLayout();
  const afterFirstEdit: OfficeLayout = {
    ...beforeStroke,
    carpetTiles: [{ variant: 0, order: 1 }, null, null, null],
  };
  const afterSecondEdit: OfficeLayout = {
    ...afterFirstEdit,
    carpetTiles: [{ variant: 0, order: 1 }, { variant: 0, order: 2 }, null, null],
  };

  editorState.beginCarpetStroke(beforeStroke);

  assert.strictEqual(editorState.takeCarpetStrokeUndoLayout(beforeStroke), beforeStroke);
  assert.strictEqual(editorState.takeCarpetStrokeUndoLayout(afterFirstEdit), null);
  assert.strictEqual(editorState.takeCarpetStrokeUndoLayout(afterSecondEdit), null);

  editorState.endCarpetStroke();

  assert.strictEqual(editorState.carpetStrokeInitialLayout, null);
});
