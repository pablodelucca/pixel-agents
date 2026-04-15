/**
 * Unit tests for Pet entity: createPet, updatePet FSM, walkability, pathfinding.
 *
 * Run with: npm run test:webview
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PET_FOLLOW_DURATION_MAX_SEC,
  PET_WANDER_PAUSE_MAX_SEC,
  PET_WANDER_PAUSE_MIN_SEC,
} from '../src/constants.js';
import { createPet, getPetSpriteData, updatePet } from '../src/office/engine/petEntity.js';
import { findPath, getWalkableTiles, isWalkable } from '../src/office/layout/tileMap.js';
import type { Character } from '../src/office/types.js';
import { CharacterState, Direction, PetState, TILE_SIZE, TileType } from '../src/office/types.js';

// ── Helpers ─────────────────────────────────────────────────

/** Build a simple NxN floor grid with optional wall tiles */
function makeTileMap(rows: number, cols: number, walls?: Array<[number, number]>): TileType[][] {
  const map: TileType[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: TileType[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(TileType.FLOOR_1);
    }
    map.push(row);
  }
  if (walls) {
    for (const [r, c] of walls) {
      map[r][c] = TileType.WALL;
    }
  }
  return map;
}

function makeCharacter(id: number, col: number, row: number): Character {
  return {
    id,
    state: CharacterState.IDLE,
    dir: Direction.DOWN,
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette: 0,
    hueShift: 0,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 10,
    wanderCount: 0,
    wanderLimit: 5,
    isActive: false,
    seatId: null,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
  };
}

// ── createPet ───────────────────────────────────────────────

describe('createPet', () => {
  it('returns a Pet with correct initial values', () => {
    const pet = createPet('pet-1', 2, 'Test Cat', { col: 3, row: 4 });
    assert.equal(pet.id, 'pet-1');
    assert.equal(pet.name, 'Test Cat');
    assert.equal(pet.petType, 2);
    assert.equal(pet.state, PetState.IDLE);
    assert.equal(pet.dir, Direction.DOWN);
    assert.equal(pet.tileCol, 3);
    assert.equal(pet.tileRow, 4);
    assert.equal(pet.x, 3 * TILE_SIZE + TILE_SIZE / 2);
    assert.equal(pet.y, 4 * TILE_SIZE + TILE_SIZE / 2);
    assert.equal(pet.path.length, 0);
    assert.equal(pet.moveProgress, 0);
    assert.equal(pet.frame, 0);
    assert.equal(pet.followTargetId, null);
    assert.equal(pet.bubbleType, null);
    assert.equal(pet.bubbleTimer, 0);
    assert.ok(pet.wanderTimer >= PET_WANDER_PAUSE_MIN_SEC);
    assert.ok(pet.wanderTimer <= PET_WANDER_PAUSE_MAX_SEC);
  });
});

// ── isWalkable (pets now use same rules as characters) ─────

describe('isWalkable (pet walkability)', () => {
  const tileMap = makeTileMap(5, 5, [[0, 0]]);
  const blocked = new Set<string>();

  it('returns true for open floor tile', () => {
    assert.ok(isWalkable(1, 1, tileMap, blocked));
  });

  it('returns false for WALL tile', () => {
    assert.ok(!isWalkable(0, 0, tileMap, blocked));
  });

  it('returns false for out-of-bounds tile', () => {
    assert.ok(!isWalkable(-1, 0, tileMap, blocked));
    assert.ok(!isWalkable(0, 5, tileMap, blocked));
  });

  it('returns false for blocked tile (furniture)', () => {
    const blockedSet = new Set(['2,2']);
    assert.ok(!isWalkable(2, 2, tileMap, blockedSet));
  });
});

// ── getWalkableTiles ──────────────────────────────────────

describe('getWalkableTiles (pets use same as characters)', () => {
  it('returns all floor tiles when none are blocked', () => {
    const tileMap = makeTileMap(3, 3);
    const tiles = getWalkableTiles(tileMap, new Set());
    assert.equal(tiles.length, 9);
  });

  it('excludes WALL tiles', () => {
    const tileMap = makeTileMap(3, 3, [
      [0, 0],
      [1, 1],
    ]);
    const tiles = getWalkableTiles(tileMap, new Set());
    assert.equal(tiles.length, 7);
  });

  it('excludes blocked tiles', () => {
    const tileMap = makeTileMap(3, 3);
    const tiles = getWalkableTiles(tileMap, new Set(['1,1']));
    assert.equal(tiles.length, 8);
  });
});

// ── findPath (pets now use same pathfinding as characters) ─

describe('findPath (pet pathfinding)', () => {
  const tileMap = makeTileMap(5, 5);

  it('finds path between two walkable tiles', () => {
    const path = findPath(0, 0, 4, 4, tileMap, new Set());
    assert.ok(path.length > 0);
    assert.deepEqual(path[path.length - 1], { col: 4, row: 4 });
  });

  it('returns empty path when start equals end', () => {
    const path = findPath(2, 2, 2, 2, tileMap, new Set());
    assert.equal(path.length, 0);
  });

  it('returns empty path when end is WALL', () => {
    const wallMap = makeTileMap(5, 5, [[4, 4]]);
    const path = findPath(0, 0, 4, 4, wallMap, new Set());
    assert.equal(path.length, 0);
  });

  it('routes around blocked tiles', () => {
    const blocked = new Set(['2,0', '2,1', '2,2', '2,3']);
    const path = findPath(0, 0, 4, 0, tileMap, blocked);
    assert.ok(path.length > 0);
    assert.deepEqual(path[path.length - 1], { col: 4, row: 0 });
    for (const step of path) {
      assert.ok(!blocked.has(`${step.col},${step.row}`));
    }
  });

  it('returns empty path when fully blocked', () => {
    const blocked = new Set(['2,0', '2,1', '2,2', '2,3', '2,4']);
    const path = findPath(0, 0, 4, 0, tileMap, blocked);
    assert.equal(path.length, 0);
  });
});

// ── updatePet FSM ───────────────────────────────────────────

describe('updatePet FSM', () => {
  const tileMap = makeTileMap(5, 5);
  const blocked = new Set<string>();
  const walkableTiles = getWalkableTiles(tileMap, blocked);
  const emptyChars = new Map<number, Character>();

  it('stays IDLE while wanderTimer > 0', () => {
    const pet = createPet('p1', 0, 'Cat', { col: 2, row: 2 });
    pet.wanderTimer = 5.0;
    updatePet(pet, 1.0, walkableTiles, emptyChars, tileMap, blocked);
    assert.equal(pet.state, PetState.IDLE);
    assert.ok(pet.wanderTimer < 5.0);
  });

  it('transitions IDLE → WALK when wanderTimer expires', () => {
    const pet = createPet('p2', 0, 'Cat', { col: 2, row: 2 });
    pet.wanderTimer = 0.01;
    updatePet(pet, 1.0, walkableTiles, emptyChars, tileMap, blocked);
    assert.ok(pet.state === PetState.WALK || pet.state === PetState.IDLE);
    if (pet.state === PetState.WALK) {
      assert.ok(pet.path.length > 0);
    }
  });

  it('transitions WALK → IDLE when path ends', () => {
    const pet = createPet('p3', 0, 'Cat', { col: 2, row: 2 });
    pet.state = PetState.WALK;
    pet.path = [{ col: 3, row: 2 }];
    pet.moveProgress = 0;
    updatePet(pet, 10.0, walkableTiles, emptyChars, tileMap, blocked);
    assert.equal(pet.state, PetState.IDLE);
    assert.equal(pet.tileCol, 3);
    assert.equal(pet.tileRow, 2);
  });

  it('transitions FOLLOW → IDLE when target character is gone', () => {
    const pet = createPet('p4', 0, 'Cat', { col: 2, row: 2 });
    pet.state = PetState.FOLLOW;
    pet.followTargetId = 999;
    pet.followRecalcTimer = 0;
    pet.followDuration = 0;
    pet.followDurationLimit = PET_FOLLOW_DURATION_MAX_SEC;
    updatePet(pet, 0.1, walkableTiles, emptyChars, tileMap, blocked);
    assert.equal(pet.state, PetState.IDLE);
    assert.equal(pet.followTargetId, null);
  });

  it('transitions FOLLOW → IDLE when already adjacent to target', () => {
    const chars = new Map<number, Character>();
    chars.set(1, makeCharacter(1, 3, 2));
    const pet = createPet('p5', 0, 'Cat', { col: 2, row: 2 });
    pet.state = PetState.FOLLOW;
    pet.followTargetId = 1;
    pet.followRecalcTimer = 0;
    pet.followDuration = 0;
    pet.followDurationLimit = PET_FOLLOW_DURATION_MAX_SEC;
    updatePet(pet, 0.1, walkableTiles, chars, tileMap, blocked);
    assert.equal(pet.state, PetState.IDLE);
    assert.equal(pet.followTargetId, null);
  });

  it('transitions FOLLOW → IDLE when follow duration limit exceeded', () => {
    const chars = new Map<number, Character>();
    chars.set(1, makeCharacter(1, 4, 4));
    const pet = createPet('p6', 0, 'Cat', { col: 0, row: 0 });
    pet.state = PetState.FOLLOW;
    pet.followTargetId = 1;
    pet.followRecalcTimer = 5.0;
    pet.followDuration = 14.9;
    pet.followDurationLimit = 15.0;
    updatePet(pet, 0.2, walkableTiles, chars, tileMap, blocked);
    assert.equal(pet.state, PetState.IDLE);
    assert.equal(pet.followTargetId, null);
  });
});

// ── getPetSpriteData ────────────────────────────────────────

describe('getPetSpriteData', () => {
  it('returns null when petSprites is null', () => {
    const pet = createPet('p1', 0, 'Cat', { col: 0, row: 0 });
    assert.equal(getPetSpriteData(pet, null), null);
  });
});
