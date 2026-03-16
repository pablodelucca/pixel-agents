import { describe, expect, it } from 'vitest';

import type { OfficeLayout, PlacedFurniture } from '../types.js';
import { FurnitureType, TileType } from '../types.js';
import {
  canPlaceFurniture,
  expandLayout,
  moveFurniture,
  paintTile,
  placeFurniture,
  removeFurniture,
  rotateFurniture,
  toggleFurnitureState,
} from './editorActions.js';

/** Build a minimal layout for testing */
function makeLayout(
  cols: number,
  rows: number,
  tiles?: number[],
  furniture?: PlacedFurniture[],
): OfficeLayout {
  return {
    version: 1,
    cols,
    rows,
    tiles: (tiles ?? new Array(cols * rows).fill(TileType.FLOOR_1)) as OfficeLayout['tiles'],
    furniture: furniture ?? [],
    tileColors: new Array(cols * rows).fill({ h: 0, s: 0, b: 0, c: 0 }),
  };
}

describe('paintTile', () => {
  it('updates tile type and color immutably', () => {
    const layout = makeLayout(3, 3);
    const color = { h: 120, s: 50, b: 10, c: 0 };
    const result = paintTile(layout, 1, 1, TileType.FLOOR_2, color);
    expect(result).not.toBe(layout);
    expect(result.tiles[1 * 3 + 1]).toBe(TileType.FLOOR_2);
    expect(result.tileColors![1 * 3 + 1]).toEqual(color);
    // Original unchanged
    expect(layout.tiles[1 * 3 + 1]).toBe(TileType.FLOOR_1);
  });

  it('returns same layout when unchanged', () => {
    const color = { h: 0, s: 0, b: 0, c: 0 };
    const layout = makeLayout(2, 2);
    // Paint with same tile type and same color → no-op
    const result = paintTile(layout, 0, 0, TileType.FLOOR_1, color);
    expect(result).toBe(layout);
  });

  it('returns same layout for out-of-bounds', () => {
    const layout = makeLayout(2, 2);
    expect(paintTile(layout, -1, 0, TileType.FLOOR_1)).toBe(layout);
    expect(paintTile(layout, 0, 5, TileType.FLOOR_1)).toBe(layout);
  });

  it('sets null color for WALL tiles', () => {
    const layout = makeLayout(2, 2);
    const result = paintTile(layout, 0, 0, TileType.WALL);
    expect(result.tileColors![0]).toBeNull();
  });
});

describe('placeFurniture / removeFurniture', () => {
  it('adds furniture to layout', () => {
    const layout = makeLayout(5, 5);
    const item: PlacedFurniture = { uid: 'p1', type: FurnitureType.PLANT, col: 2, row: 2 };
    const result = placeFurniture(layout, item);
    expect(result.furniture).toHaveLength(1);
    expect(result.furniture[0]).toEqual(item);
    expect(layout.furniture).toHaveLength(0); // immutable
  });

  it('removes furniture by uid', () => {
    const items: PlacedFurniture[] = [
      { uid: 'a', type: FurnitureType.PLANT, col: 0, row: 0 },
      { uid: 'b', type: FurnitureType.PLANT, col: 1, row: 0 },
    ];
    const layout = makeLayout(5, 5, undefined, items);
    const result = removeFurniture(layout, 'a');
    expect(result.furniture).toHaveLength(1);
    expect(result.furniture[0].uid).toBe('b');
  });

  it('returns same layout when uid not found', () => {
    const layout = makeLayout(5, 5);
    expect(removeFurniture(layout, 'nonexistent')).toBe(layout);
  });
});

describe('moveFurniture', () => {
  it('moves furniture to new position', () => {
    const items: PlacedFurniture[] = [{ uid: 'p1', type: FurnitureType.PLANT, col: 1, row: 1 }];
    const layout = makeLayout(5, 5, undefined, items);
    const result = moveFurniture(layout, 'p1', 3, 3);
    expect(result.furniture[0].col).toBe(3);
    expect(result.furniture[0].row).toBe(3);
    expect(layout.furniture[0].col).toBe(1); // immutable
  });

  it('returns same layout when uid not found', () => {
    const layout = makeLayout(5, 5);
    expect(moveFurniture(layout, 'nope', 0, 0)).toBe(layout);
  });
});

describe('canPlaceFurniture', () => {
  it('allows placement on floor tiles', () => {
    const layout = makeLayout(5, 5);
    expect(canPlaceFurniture(layout, FurnitureType.PLANT, 2, 2)).toBe(true);
  });

  it('rejects out-of-bounds placement', () => {
    const layout = makeLayout(5, 5);
    expect(canPlaceFurniture(layout, FurnitureType.PLANT, -1, 0)).toBe(false);
    expect(canPlaceFurniture(layout, FurnitureType.PLANT, 5, 0)).toBe(false);
    expect(canPlaceFurniture(layout, FurnitureType.PLANT, 0, 5)).toBe(false);
  });

  it('rejects placement on VOID tiles', () => {
    const tiles = new Array(25).fill(TileType.VOID);
    const layout = makeLayout(5, 5, tiles);
    expect(canPlaceFurniture(layout, FurnitureType.PLANT, 2, 2)).toBe(false);
  });

  it('rejects placement on WALL tiles for non-wall items', () => {
    const tiles = new Array(25).fill(TileType.WALL);
    const layout = makeLayout(5, 5, tiles);
    expect(canPlaceFurniture(layout, FurnitureType.PLANT, 2, 2)).toBe(false);
  });

  it('rejects overlapping furniture', () => {
    const items: PlacedFurniture[] = [
      { uid: 'existing', type: FurnitureType.PLANT, col: 2, row: 2 },
    ];
    const layout = makeLayout(5, 5, undefined, items);
    expect(canPlaceFurniture(layout, FurnitureType.PLANT, 2, 2)).toBe(false);
  });

  it('allows placement when excluding own uid (for move)', () => {
    const items: PlacedFurniture[] = [{ uid: 'self', type: FurnitureType.PLANT, col: 2, row: 2 }];
    const layout = makeLayout(5, 5, undefined, items);
    expect(canPlaceFurniture(layout, FurnitureType.PLANT, 2, 2, 'self')).toBe(true);
  });

  it('rejects 2×2 desk that extends out of bounds', () => {
    const layout = makeLayout(5, 5);
    // Desk is 2×2, placing at col=4 would go to col 5 (out of bounds)
    expect(canPlaceFurniture(layout, FurnitureType.DESK, 4, 0)).toBe(false);
    expect(canPlaceFurniture(layout, FurnitureType.DESK, 0, 4)).toBe(false);
  });
});

describe('rotateFurniture', () => {
  it('returns same layout for non-rotatable items', () => {
    // Built-in items like PLANT have no rotation groups
    const items: PlacedFurniture[] = [{ uid: 'p1', type: FurnitureType.PLANT, col: 0, row: 0 }];
    const layout = makeLayout(5, 5, undefined, items);
    expect(rotateFurniture(layout, 'p1', 'cw')).toBe(layout);
  });

  it('returns same layout for unknown uid', () => {
    const layout = makeLayout(5, 5);
    expect(rotateFurniture(layout, 'nope', 'cw')).toBe(layout);
  });
});

describe('toggleFurnitureState', () => {
  it('returns same layout for items without state groups', () => {
    const items: PlacedFurniture[] = [{ uid: 'p1', type: FurnitureType.PLANT, col: 0, row: 0 }];
    const layout = makeLayout(5, 5, undefined, items);
    expect(toggleFurnitureState(layout, 'p1')).toBe(layout);
  });

  it('returns same layout for unknown uid', () => {
    const layout = makeLayout(5, 5);
    expect(toggleFurnitureState(layout, 'nope')).toBe(layout);
  });
});

describe('expandLayout', () => {
  it('expands right', () => {
    const layout = makeLayout(3, 2);
    const result = expandLayout(layout, 'right');
    expect(result).not.toBeNull();
    expect(result!.layout.cols).toBe(4);
    expect(result!.layout.rows).toBe(2);
    expect(result!.shift).toEqual({ col: 0, row: 0 });
  });

  it('expands left with shift', () => {
    const items: PlacedFurniture[] = [{ uid: 'p1', type: FurnitureType.PLANT, col: 1, row: 0 }];
    const layout = makeLayout(3, 2, undefined, items);
    const result = expandLayout(layout, 'left');
    expect(result).not.toBeNull();
    expect(result!.layout.cols).toBe(4);
    expect(result!.shift).toEqual({ col: 1, row: 0 });
    // Furniture shifted
    expect(result!.layout.furniture[0].col).toBe(2);
  });

  it('expands down', () => {
    const layout = makeLayout(3, 2);
    const result = expandLayout(layout, 'down');
    expect(result).not.toBeNull();
    expect(result!.layout.rows).toBe(3);
    expect(result!.shift).toEqual({ col: 0, row: 0 });
  });

  it('expands up with shift', () => {
    const items: PlacedFurniture[] = [{ uid: 'p1', type: FurnitureType.PLANT, col: 0, row: 1 }];
    const layout = makeLayout(3, 2, undefined, items);
    const result = expandLayout(layout, 'up');
    expect(result).not.toBeNull();
    expect(result!.layout.rows).toBe(3);
    expect(result!.shift).toEqual({ col: 0, row: 1 });
    expect(result!.layout.furniture[0].row).toBe(2);
  });

  it('new tiles are VOID', () => {
    const layout = makeLayout(2, 2);
    const result = expandLayout(layout, 'right')!;
    // Third column should be VOID
    expect(result.layout.tiles[2]).toBe(TileType.VOID);
    expect(result.layout.tiles[5]).toBe(TileType.VOID);
  });

  it('preserves existing tiles', () => {
    const tiles = [TileType.FLOOR_1, TileType.FLOOR_2, TileType.FLOOR_3, TileType.WALL];
    const layout = makeLayout(2, 2, tiles);
    const result = expandLayout(layout, 'right')!;
    // Row 0: F1, F2, VOID
    expect(result.layout.tiles[0]).toBe(TileType.FLOOR_1);
    expect(result.layout.tiles[1]).toBe(TileType.FLOOR_2);
    // Row 1: F3, W, VOID
    expect(result.layout.tiles[3]).toBe(TileType.FLOOR_3);
    expect(result.layout.tiles[4]).toBe(TileType.WALL);
  });

  it('returns null at MAX bounds', () => {
    const layout = makeLayout(64, 64);
    expect(expandLayout(layout, 'right')).toBeNull();
    expect(expandLayout(layout, 'down')).toBeNull();
    expect(expandLayout(layout, 'left')).toBeNull();
    expect(expandLayout(layout, 'up')).toBeNull();
  });
});
