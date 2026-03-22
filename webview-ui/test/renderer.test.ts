import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WALL_COLOR } from '../src/office/floorTiles.js';
import { renderTileGrid } from '../src/office/engine/renderer.js';
import { TileType } from '../src/office/types.js';

function createContextStub() {
  const operations: Array<{ type: 'fillRect' | 'drawImage'; fillStyle?: string }> = [];

  const ctx = {
    fillStyle: '',
    fillRect() {
      operations.push({ type: 'fillRect', fillStyle: this.fillStyle });
    },
    drawImage() {
      operations.push({ type: 'drawImage' });
    },
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, operations };
}

test('renderTileGrid paints glass walls with the wall fallback color', () => {
  const { ctx, operations } = createContextStub();
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            imageSmoothingEnabled: false,
            fillStyle: '',
            fillRect() {},
          };
        },
      };
    },
  } as unknown as Document;

  try {
    renderTileGrid(ctx, [[TileType.GLASS_WALL]], 0, 0, 1);
  } finally {
    globalThis.document = originalDocument;
  }

  assert.deepEqual(operations, [{ type: 'fillRect', fillStyle: WALL_COLOR }]);
});
