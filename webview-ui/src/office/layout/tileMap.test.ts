import { describe, expect, it } from 'vitest';

import { TileType } from '../types.js';
import { findPath, getWalkableTiles, isWalkable } from './tileMap.js';

// Helper: build a 2D tile map from a compact representation
// W=wall, F=floor, V=void
function makeTileMap(grid: string[]): (typeof TileType)[keyof typeof TileType][][] {
  return grid.map((row) =>
    row.split('').map((ch) => {
      if (ch === 'W') return TileType.WALL;
      if (ch === 'V') return TileType.VOID;
      return TileType.FLOOR_1;
    }),
  );
}

describe('isWalkable', () => {
  const map = makeTileMap(['WFW', 'FFF', 'WFW']);
  const blocked = new Set<string>();

  it('returns true for floor tiles', () => {
    expect(isWalkable(1, 0, map, blocked)).toBe(true);
    expect(isWalkable(0, 1, map, blocked)).toBe(true);
    expect(isWalkable(1, 1, map, blocked)).toBe(true);
  });

  it('returns false for wall tiles', () => {
    expect(isWalkable(0, 0, map, blocked)).toBe(false);
    expect(isWalkable(2, 0, map, blocked)).toBe(false);
  });

  it('returns false for out-of-bounds', () => {
    expect(isWalkable(-1, 0, map, blocked)).toBe(false);
    expect(isWalkable(0, -1, map, blocked)).toBe(false);
    expect(isWalkable(3, 0, map, blocked)).toBe(false);
    expect(isWalkable(0, 3, map, blocked)).toBe(false);
  });

  it('returns false for blocked tiles', () => {
    const blockedSet = new Set(['1,1']);
    expect(isWalkable(1, 1, map, blockedSet)).toBe(false);
  });

  it('returns false for VOID tiles', () => {
    const voidMap = makeTileMap(['FVF']);
    expect(isWalkable(1, 0, voidMap, blocked)).toBe(false);
  });
});

describe('getWalkableTiles', () => {
  it('returns all walkable positions', () => {
    const map = makeTileMap(['WFW', 'FFF', 'WFW']);
    const tiles = getWalkableTiles(map, new Set());
    expect(tiles).toHaveLength(5);
    expect(tiles).toContainEqual({ col: 1, row: 0 });
    expect(tiles).toContainEqual({ col: 0, row: 1 });
    expect(tiles).toContainEqual({ col: 1, row: 1 });
    expect(tiles).toContainEqual({ col: 2, row: 1 });
    expect(tiles).toContainEqual({ col: 1, row: 2 });
  });

  it('excludes blocked tiles', () => {
    const map = makeTileMap(['FF', 'FF']);
    const blocked = new Set(['0,0']);
    const tiles = getWalkableTiles(map, blocked);
    expect(tiles).toHaveLength(3);
    expect(tiles).not.toContainEqual({ col: 0, row: 0 });
  });

  it('returns empty for all-wall map', () => {
    const map = makeTileMap(['WW', 'WW']);
    expect(getWalkableTiles(map, new Set())).toHaveLength(0);
  });
});

describe('findPath', () => {
  it('returns empty when start equals end', () => {
    const map = makeTileMap(['FFF']);
    expect(findPath(0, 0, 0, 0, map, new Set())).toEqual([]);
  });

  it('finds shortest path on straight line', () => {
    const map = makeTileMap(['FFFF']);
    const path = findPath(0, 0, 3, 0, map, new Set());
    expect(path).toEqual([
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 3, row: 0 },
    ]);
  });

  it('finds path around obstacle', () => {
    // F F F
    // F W F
    // F F F
    const map = makeTileMap(['FFF', 'FWF', 'FFF']);
    const path = findPath(0, 1, 2, 1, map, new Set());
    // Must go around the wall — path length is 4 (either up or down)
    expect(path).toHaveLength(4);
    expect(path[path.length - 1]).toEqual({ col: 2, row: 1 });
  });

  it('returns empty when destination is unreachable', () => {
    // Two disconnected rooms
    const map = makeTileMap(['FWF', 'FWF', 'FWF']);
    expect(findPath(0, 0, 2, 0, map, new Set())).toEqual([]);
  });

  it('returns empty when destination is a wall', () => {
    const map = makeTileMap(['FWF']);
    expect(findPath(0, 0, 1, 0, map, new Set())).toEqual([]);
  });

  it('respects blocked tiles', () => {
    const map = makeTileMap(['FFF']);
    const blocked = new Set(['1,0']);
    expect(findPath(0, 0, 2, 0, map, blocked)).toEqual([]);
  });

  it('does not use diagonal moves', () => {
    const map = makeTileMap(['FF', 'FF']);
    const path = findPath(0, 0, 1, 1, map, new Set());
    // Should be 2 steps (right+down or down+right), not 1 diagonal
    expect(path).toHaveLength(2);
  });

  it('path excludes start, includes end', () => {
    const map = makeTileMap(['FF']);
    const path = findPath(0, 0, 1, 0, map, new Set());
    expect(path).toEqual([{ col: 1, row: 0 }]);
  });
});
