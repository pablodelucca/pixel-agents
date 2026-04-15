import {
  PET_FOLLOW_CHANCE,
  PET_FOLLOW_DURATION_MAX_SEC,
  PET_FOLLOW_DURATION_MIN_SEC,
  PET_FOLLOW_RADIUS_TILES,
  PET_FOLLOW_RECALC_INTERVAL_SEC,
  PET_IDLE_FRAME_DURATION_SEC,
  PET_IDLE_SEQUENCE,
  PET_WALK_FRAME_DURATION_SEC,
  PET_WALK_SEQUENCE,
  PET_WALK_SPEED_PX_PER_SEC,
  PET_WANDER_PAUSE_MAX_SEC,
  PET_WANDER_PAUSE_MIN_SEC,
} from '../../constants.js';
import { findPath, isWalkable } from '../layout/tileMap.js';
import type { PetSpriteFrames } from '../sprites/petSpriteData.js';
import type { Character, Pet, SpriteData, TileType as TileTypeVal } from '../types.js';
import { Direction, PetState, TILE_SIZE } from '../types.js';

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function tileCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}

function directionBetween(
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
): Direction {
  const dc = toCol - fromCol;
  const dr = toRow - fromRow;
  if (dc > 0) return Direction.RIGHT;
  if (dc < 0) return Direction.LEFT;
  if (dr > 0) return Direction.DOWN;
  return Direction.UP;
}

function manhattanDistance(col1: number, row1: number, col2: number, row2: number): number {
  return Math.abs(col1 - col2) + Math.abs(row1 - row2);
}

export function createPet(
  id: string,
  petType: number,
  name: string,
  spawnTile: { col: number; row: number },
): Pet {
  const center = tileCenter(spawnTile.col, spawnTile.row);
  return {
    id,
    name,
    petType,
    state: PetState.IDLE,
    dir: Direction.DOWN,
    x: center.x,
    y: center.y,
    tileCol: spawnTile.col,
    tileRow: spawnTile.row,
    path: [],
    moveProgress: 0,
    frame: 0,
    frameTimer: 0,
    wanderTimer: randomBetween(PET_WANDER_PAUSE_MIN_SEC, PET_WANDER_PAUSE_MAX_SEC),
    followTargetId: null,
    followRecalcTimer: 0,
    followDuration: 0,
    followDurationLimit: 0,
    bubbleType: null,
    bubbleTimer: 0,
  };
}

/** Find the closest character within follow radius, or null */
function findNearbyCharacter(pet: Pet, characters: Map<number, Character>): Character | null {
  let closest: Character | null = null;
  let closestDist = Infinity;
  for (const ch of characters.values()) {
    const dist = manhattanDistance(pet.tileCol, pet.tileRow, ch.tileCol, ch.tileRow);
    if (dist <= PET_FOLLOW_RADIUS_TILES && dist < closestDist) {
      closestDist = dist;
      closest = ch;
    }
  }
  return closest;
}

/** Find a walkable tile adjacent to a character */
function findAdjacentTile(
  ch: Character,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): { col: number; row: number } | null {
  const offsets = [
    { dc: 0, dr: -1 },
    { dc: 0, dr: 1 },
    { dc: -1, dr: 0 },
    { dc: 1, dr: 0 },
  ];
  for (const { dc, dr } of offsets) {
    const nc = ch.tileCol + dc;
    const nr = ch.tileRow + dr;
    if (isWalkable(nc, nr, tileMap, blockedTiles)) {
      return { col: nc, row: nr };
    }
  }
  return null;
}

function movePetAlongPath(pet: Pet, dt: number): void {
  if (pet.path.length === 0) return;

  const next = pet.path[0];
  pet.dir = directionBetween(pet.tileCol, pet.tileRow, next.col, next.row);

  pet.moveProgress += (PET_WALK_SPEED_PX_PER_SEC / TILE_SIZE) * dt;

  const from = tileCenter(pet.tileCol, pet.tileRow);
  const to = tileCenter(next.col, next.row);
  const t = Math.min(pet.moveProgress, 1);
  pet.x = from.x + (to.x - from.x) * t;
  pet.y = from.y + (to.y - from.y) * t;

  if (pet.moveProgress >= 1) {
    pet.tileCol = next.col;
    pet.tileRow = next.row;
    pet.x = to.x;
    pet.y = to.y;
    pet.path.shift();
    pet.moveProgress = 0;
  }
}

function updateWalkAnimation(pet: Pet): void {
  if (pet.frameTimer >= PET_WALK_FRAME_DURATION_SEC) {
    pet.frameTimer -= PET_WALK_FRAME_DURATION_SEC;
    pet.frame = (pet.frame + 1) % PET_WALK_SEQUENCE.length;
  }
}

function updateIdleAnimation(pet: Pet): void {
  if (pet.frameTimer >= PET_IDLE_FRAME_DURATION_SEC) {
    pet.frameTimer -= PET_IDLE_FRAME_DURATION_SEC;
    pet.frame = (pet.frame + 1) % PET_IDLE_SEQUENCE.length;
  }
}

export function updatePet(
  pet: Pet,
  dt: number,
  walkableTiles: Array<{ col: number; row: number }>,
  characters: Map<number, Character>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): void {
  pet.frameTimer += dt;

  switch (pet.state) {
    case PetState.IDLE: {
      updateIdleAnimation(pet);
      pet.wanderTimer -= dt;
      if (pet.wanderTimer > 0) return;

      // Clean up stale follow target
      if (pet.followTargetId !== null && !characters.has(pet.followTargetId)) {
        pet.followTargetId = null;
      }

      // Try to follow a nearby character
      if (characters.size > 0 && Math.random() < PET_FOLLOW_CHANCE) {
        const nearby = findNearbyCharacter(pet, characters);
        if (nearby) {
          pet.followTargetId = nearby.id;
          pet.followRecalcTimer = 0;
          pet.followDuration = 0;
          pet.followDurationLimit = randomBetween(
            PET_FOLLOW_DURATION_MIN_SEC,
            PET_FOLLOW_DURATION_MAX_SEC,
          );
          pet.state = PetState.FOLLOW;
          pet.frame = 0;
          pet.frameTimer = 0;
          return;
        }
      }

      // Wander to random tile (exclude current tile to avoid no-op pathfinding)
      const candidates = walkableTiles.filter(
        (t) => t.col !== pet.tileCol || t.row !== pet.tileRow,
      );
      if (candidates.length > 0) {
        const target = candidates[Math.floor(Math.random() * candidates.length)];
        const path = findPath(
          pet.tileCol,
          pet.tileRow,
          target.col,
          target.row,
          tileMap,
          blockedTiles,
        );
        if (path.length > 0) {
          pet.path = path;
          pet.moveProgress = 0;
          pet.state = PetState.WALK;
          pet.frame = 0;
          pet.frameTimer = 0;
        }
      }
      pet.wanderTimer = randomBetween(PET_WANDER_PAUSE_MIN_SEC, PET_WANDER_PAUSE_MAX_SEC);
      break;
    }

    case PetState.WALK: {
      updateWalkAnimation(pet);
      movePetAlongPath(pet, dt);
      if (pet.path.length === 0 && pet.moveProgress === 0) {
        pet.state = PetState.IDLE;
        pet.wanderTimer = randomBetween(PET_WANDER_PAUSE_MIN_SEC, PET_WANDER_PAUSE_MAX_SEC);
        pet.frame = 0;
        pet.frameTimer = 0;
      }
      break;
    }

    case PetState.FOLLOW: {
      pet.followDuration += dt;

      // Time limit reached
      if (pet.followDuration >= pet.followDurationLimit) {
        pet.state = PetState.IDLE;
        pet.followTargetId = null;
        pet.wanderTimer = randomBetween(PET_WANDER_PAUSE_MIN_SEC, PET_WANDER_PAUSE_MAX_SEC);
        pet.path = [];
        pet.moveProgress = 0;
        pet.frame = 0;
        pet.frameTimer = 0;
        return;
      }

      const target = pet.followTargetId !== null ? characters.get(pet.followTargetId) : undefined;
      if (!target) {
        pet.state = PetState.IDLE;
        pet.followTargetId = null;
        pet.wanderTimer = randomBetween(PET_WANDER_PAUSE_MIN_SEC, PET_WANDER_PAUSE_MAX_SEC);
        pet.path = [];
        pet.moveProgress = 0;
        pet.frame = 0;
        pet.frameTimer = 0;
        return;
      }

      // Already adjacent — idle
      if (manhattanDistance(pet.tileCol, pet.tileRow, target.tileCol, target.tileRow) <= 1) {
        pet.dir = directionBetween(pet.tileCol, pet.tileRow, target.tileCol, target.tileRow);
        pet.state = PetState.IDLE;
        pet.followTargetId = null;
        pet.wanderTimer = randomBetween(PET_WANDER_PAUSE_MIN_SEC, PET_WANDER_PAUSE_MAX_SEC);
        pet.path = [];
        pet.moveProgress = 0;
        pet.frame = 0;
        pet.frameTimer = 0;
        return;
      }

      // Recalculate path periodically
      pet.followRecalcTimer -= dt;
      if (pet.followRecalcTimer <= 0) {
        const adjTile = findAdjacentTile(target, tileMap, blockedTiles);
        if (adjTile) {
          const newPath = findPath(
            pet.tileCol,
            pet.tileRow,
            adjTile.col,
            adjTile.row,
            tileMap,
            blockedTiles,
          );
          if (newPath.length > 0) {
            pet.path = newPath;
            pet.moveProgress = 0;
          }
        }
        pet.followRecalcTimer = PET_FOLLOW_RECALC_INTERVAL_SEC;
      }

      // Move along path
      updateWalkAnimation(pet);
      movePetAlongPath(pet, dt);
      break;
    }
  }
}

/** Get the current sprite frame for a pet based on its state, direction, and animation frame */
export function getPetSpriteData(pet: Pet, petSprites: PetSpriteFrames | null): SpriteData | null {
  if (!petSprites) return null;

  const dir = pet.dir;

  if (pet.state === PetState.IDLE) {
    const idleFrame = PET_IDLE_SEQUENCE[pet.frame % PET_IDLE_SEQUENCE.length];
    switch (dir) {
      case Direction.DOWN:
        return petSprites.idleDown[idleFrame];
      case Direction.UP:
        return petSprites.idleUp[idleFrame];
      case Direction.RIGHT:
        return petSprites.idleRight[idleFrame];
      case Direction.LEFT:
        return petSprites.idleLeft[idleFrame];
    }
  }

  // WALK and FOLLOW use the same walk frames
  const walkFrame = PET_WALK_SEQUENCE[pet.frame % PET_WALK_SEQUENCE.length];
  switch (dir) {
    case Direction.DOWN:
      return petSprites.walkDown[walkFrame];
    case Direction.UP:
      return petSprites.walkUp[walkFrame];
    case Direction.RIGHT:
      return petSprites.walkRight[walkFrame];
    case Direction.LEFT:
      return petSprites.walkLeft[walkFrame];
  }
}
