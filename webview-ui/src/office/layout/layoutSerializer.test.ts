import { describe, expect, it } from 'vitest';

import type { OfficeLayout, PlacedFurniture } from '../types.js';
import { Direction, FurnitureType, TileType } from '../types.js';
import {
  createDefaultLayout,
  deserializeLayout,
  getBlockedTiles,
  getPlacementBlockedTiles,
  layoutToSeats,
  layoutToTileMap,
  migrateLayoutColors,
  serializeLayout,
} from './layoutSerializer.js';

/** Build a minimal layout for testing */
function makeLayout(
  cols: number,
  rows: number,
  tiles: number[],
  furniture: PlacedFurniture[] = [],
  tileColors?: Array<{ h: number; s: number; b: number; c: number } | null>,
): OfficeLayout {
  return {
    version: 1,
    cols,
    rows,
    tiles: tiles as OfficeLayout['tiles'],
    furniture,
    ...(tileColors ? { tileColors } : {}),
  };
}

describe('layoutToTileMap', () => {
  it('converts flat array to 2D grid', () => {
    const layout = makeLayout(3, 2, [0, 1, 2, 3, 4, 5]);
    const map = layoutToTileMap(layout);
    expect(map).toHaveLength(2);
    expect(map[0]).toEqual([0, 1, 2]);
    expect(map[1]).toEqual([3, 4, 5]);
  });

  it('handles 1×1 grid', () => {
    const layout = makeLayout(1, 1, [1]);
    const map = layoutToTileMap(layout);
    expect(map).toEqual([[1]]);
  });
});

describe('layoutToSeats', () => {
  it('creates seats from chair furniture', () => {
    const furniture: PlacedFurniture[] = [
      { uid: 'chair-1', type: FurnitureType.CHAIR, col: 2, row: 3 },
    ];
    const seats = layoutToSeats(furniture);
    expect(seats.size).toBe(1);
    const seat = seats.get('chair-1')!;
    expect(seat.seatCol).toBe(2);
    expect(seat.seatRow).toBe(3);
    expect(seat.assigned).toBe(false);
  });

  it('faces adjacent desk when no orientation', () => {
    const furniture: PlacedFurniture[] = [
      { uid: 'desk-1', type: FurnitureType.DESK, col: 2, row: 1 }, // 2×2 desk
      { uid: 'chair-1', type: FurnitureType.CHAIR, col: 2, row: 3 }, // below desk
    ];
    const seats = layoutToSeats(furniture);
    const seat = seats.get('chair-1')!;
    // Desk at (2,1) occupies (2,1),(3,1),(2,2),(3,2). Chair at (2,3).
    // Adjacent desk tile at (2,2) is above chair → face UP
    expect(seat.facingDir).toBe(Direction.UP);
  });

  it('defaults to DOWN when no desk adjacent and no orientation', () => {
    const furniture: PlacedFurniture[] = [
      { uid: 'chair-1', type: FurnitureType.CHAIR, col: 5, row: 5 },
    ];
    const seats = layoutToSeats(furniture);
    expect(seats.get('chair-1')!.facingDir).toBe(Direction.DOWN);
  });

  it('ignores non-chair furniture', () => {
    const furniture: PlacedFurniture[] = [
      { uid: 'desk-1', type: FurnitureType.DESK, col: 0, row: 0 },
      { uid: 'plant-1', type: FurnitureType.PLANT, col: 3, row: 3 },
    ];
    const seats = layoutToSeats(furniture);
    expect(seats.size).toBe(0);
  });
});

describe('getBlockedTiles', () => {
  it('returns footprint tiles for furniture', () => {
    const furniture: PlacedFurniture[] = [
      { uid: 'desk-1', type: FurnitureType.DESK, col: 1, row: 1 }, // 2×2
    ];
    const blocked = getBlockedTiles(furniture);
    expect(blocked.has('1,1')).toBe(true);
    expect(blocked.has('2,1')).toBe(true);
    expect(blocked.has('1,2')).toBe(true);
    expect(blocked.has('2,2')).toBe(true);
    expect(blocked.size).toBe(4);
  });

  it('respects excludeTiles', () => {
    const furniture: PlacedFurniture[] = [
      { uid: 'plant-1', type: FurnitureType.PLANT, col: 3, row: 3 },
    ];
    const exclude = new Set(['3,3']);
    const blocked = getBlockedTiles(furniture, exclude);
    expect(blocked.has('3,3')).toBe(false);
  });
});

describe('getPlacementBlockedTiles', () => {
  it('excludes specified uid', () => {
    const furniture: PlacedFurniture[] = [
      { uid: 'a', type: FurnitureType.PLANT, col: 0, row: 0 },
      { uid: 'b', type: FurnitureType.PLANT, col: 1, row: 0 },
    ];
    const blocked = getPlacementBlockedTiles(furniture, 'a');
    expect(blocked.has('0,0')).toBe(false);
    expect(blocked.has('1,0')).toBe(true);
  });
});

describe('migrateLayoutColors', () => {
  it('no-ops when tileColors already present and correct length', () => {
    const colors = [{ h: 0, s: 0, b: 0, c: 0 }];
    const layout = makeLayout(1, 1, [1], [], colors);
    const migrated = migrateLayoutColors(layout);
    expect(migrated).toBe(layout); // same reference
  });

  it('generates tileColors for old layouts', () => {
    const layout = makeLayout(2, 1, [0, 1]); // WALL, FLOOR_1
    const migrated = migrateLayoutColors(layout);
    expect(migrated.tileColors).toBeDefined();
    expect(migrated.tileColors).toHaveLength(2);
    expect(migrated.tileColors![0]).toBeNull(); // WALL → null
    expect(migrated.tileColors![1]).toEqual({ h: 35, s: 30, b: 15, c: 0 }); // FLOOR_1 → beige
  });

  it('maps all legacy tile types correctly', () => {
    const layout = makeLayout(5, 1, [0, 1, 2, 3, 4]);
    const migrated = migrateLayoutColors(layout);
    expect(migrated.tileColors![0]).toBeNull(); // WALL
    expect(migrated.tileColors![1]).toEqual({ h: 35, s: 30, b: 15, c: 0 }); // FLOOR_1
    expect(migrated.tileColors![2]).toEqual({ h: 25, s: 45, b: 5, c: 10 }); // FLOOR_2
    expect(migrated.tileColors![3]).toEqual({ h: 280, s: 40, b: -5, c: 0 }); // FLOOR_3
    expect(migrated.tileColors![4]).toEqual({ h: 35, s: 25, b: 10, c: 0 }); // FLOOR_4
  });
});

describe('serializeLayout / deserializeLayout round-trip', () => {
  it('round-trips a layout', () => {
    const layout = makeLayout(
      2,
      2,
      [TileType.WALL, TileType.FLOOR_1, TileType.FLOOR_2, TileType.WALL],
      [{ uid: 'p1', type: FurnitureType.PLANT, col: 1, row: 0 }],
      [null, { h: 35, s: 30, b: 15, c: 0 }, { h: 25, s: 45, b: 5, c: 10 }, null],
    );
    const json = serializeLayout(layout);
    const deserialized = deserializeLayout(json);
    expect(deserialized).toEqual(layout);
  });

  it('returns null for invalid JSON', () => {
    expect(deserializeLayout('not json')).toBeNull();
  });

  it('returns null for wrong version', () => {
    expect(deserializeLayout(JSON.stringify({ version: 2, tiles: [], furniture: [] }))).toBeNull();
  });

  it('returns null for missing tiles', () => {
    expect(deserializeLayout(JSON.stringify({ version: 1, furniture: [] }))).toBeNull();
  });
});

describe('createDefaultLayout', () => {
  it('returns valid structure', () => {
    const layout = createDefaultLayout();
    expect(layout.version).toBe(1);
    expect(layout.cols).toBe(20);
    expect(layout.rows).toBe(11);
    expect(layout.tiles).toHaveLength(20 * 11);
    expect(layout.tileColors).toHaveLength(20 * 11);
    expect(layout.furniture.length).toBeGreaterThan(0);
  });

  it('has walls on edges', () => {
    const layout = createDefaultLayout();
    // Top row
    for (let c = 0; c < layout.cols; c++) {
      expect(layout.tiles[c]).toBe(TileType.WALL);
    }
    // Bottom row
    for (let c = 0; c < layout.cols; c++) {
      expect(layout.tiles[(layout.rows - 1) * layout.cols + c]).toBe(TileType.WALL);
    }
    // Left column
    for (let r = 0; r < layout.rows; r++) {
      expect(layout.tiles[r * layout.cols]).toBe(TileType.WALL);
    }
    // Right column
    for (let r = 0; r < layout.rows; r++) {
      expect(layout.tiles[r * layout.cols + (layout.cols - 1)]).toBe(TileType.WALL);
    }
  });

  it('has furniture within bounds', () => {
    const layout = createDefaultLayout();
    for (const f of layout.furniture) {
      expect(f.col).toBeGreaterThanOrEqual(0);
      expect(f.row).toBeGreaterThanOrEqual(0);
      expect(f.col).toBeLessThan(layout.cols);
      expect(f.row).toBeLessThan(layout.rows);
    }
  });
});
