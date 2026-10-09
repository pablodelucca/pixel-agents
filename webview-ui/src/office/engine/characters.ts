import {
  DEFAULT_MAX_CONTEXT_TOKENS,
  GAME_JOIN_CHANCE,
  SEAT_REST_MAX_SEC,
  SEAT_REST_MIN_SEC,
  TYPE_FRAME_DURATION_SEC,
  WALK_FRAME_DURATION_SEC,
  WALK_SPEED_PX_PER_SEC,
  WANDER_MOVES_BEFORE_REST_MAX,
  WANDER_MOVES_BEFORE_REST_MIN,
  WANDER_PAUSE_MAX_SEC,
  WANDER_PAUSE_MIN_SEC,
} from '../../constants.js';
import { findPath } from '../layout/tileMap.js';
import type { CharacterSprites } from '../sprites/spriteData.js';
import { getPlaySprites } from '../sprites/spriteData.js';
import { isReadingToolName } from '../toolUtils.js';
import type {
  Character,
  GameSlot,
  Seat,
  SpriteData,
  TileType as TileTypeVal,
  WaitSpot,
} from '../types.js';
import { CharacterState, Direction, TILE_SIZE } from '../types.js';

/** Whether a tool should show the reading animation (vs typing). Taxonomy comes
 *  from the active HookProvider via the `providerCapabilities` message. */
export function isReadingTool(tool: string | null): boolean {
  if (!tool) return false;
  return isReadingToolName(tool);
}

/** Pixel center of a tile */
function tileCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/** Direction from one tile to an adjacent tile */
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

export function createCharacter(
  id: number,
  palette: number,
  seatId: string | null,
  seat: Seat | null,
  hueShift = 0,
): Character {
  const col = seat ? seat.seatCol : 1;
  const row = seat ? seat.seatRow : 1;
  const center = tileCenter(col, row);
  return {
    id,
    state: CharacterState.TYPE,
    dir: seat ? seat.facingDir : Direction.DOWN,
    x: center.x,
    y: center.y,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette,
    hueShift,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX),
    isActive: true,
    seatId,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    playSlot: null,
    waitSpot: null,
    queuedAt: 0,
    celebrateTimer: 0,
    swingTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    contextTokens: 0,
    maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
  };
}

/** Seated pose (sitting offset + sitting frames): working at a desk, or waiting on a couch. */
export function isSeatedPose(ch: Character): boolean {
  return (
    ch.state === CharacterState.TYPE || (ch.state === CharacterState.QUEUE && !!ch.waitSpot?.seatId)
  );
}

/** Seat tiles are blocked for everyone; a spectator heading for a couch spot needs its own
 *  target tile opened up, like players do for their desk chair. */
function blockedExcept(blockedTiles: Set<string>, target: WaitSpot | GameSlot): Set<string> {
  if (!('seatId' in target) || !target.seatId) return blockedTiles;
  const copy = new Set(blockedTiles);
  copy.delete(`${target.col},${target.row}`);
  return copy;
}

export function updateCharacter(
  ch: Character,
  dt: number,
  walkableTiles: Array<{ col: number; row: number }>,
  seats: Map<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
  /** Table ends this character may claim (free, and not owed to a queue it isn't heading) */
  freeSlots: GameSlot[] = [],
  /** Spectator spots nobody has claimed yet */
  freeWaits: WaitSpot[] = [],
): void {
  ch.frameTimer += dt;
  if (ch.celebrateTimer > 0) ch.celebrateTimer = Math.max(0, ch.celebrateTimer - dt);
  if (ch.swingTimer > 0) ch.swingTimer = Math.max(0, ch.swingTimer - dt);

  switch (ch.state) {
    case CharacterState.PLAY: {
      // Ready pose; the swing frame shows only while swingTimer runs (set by the match on a hit)
      ch.frame = ch.swingTimer > 0 ? 1 : 0;
      // Play until work arrives (or the table vanished). IDLE then heads to the seat.
      if (ch.isActive || !ch.playSlot) {
        ch.playSlot = null;
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        ch.wanderTimer = 0;
      }
      break;
    }

    case CharacterState.QUEUE: {
      ch.frame = 0;
      // Leave the line when work arrives, the table vanished, or the couch we sit on
      // was just assigned to an agent as its desk seat
      const couchTaken = !!ch.waitSpot?.seatId && !!seats.get(ch.waitSpot.seatId)?.assigned;
      if (ch.isActive || !ch.waitSpot || couchTaken) {
        ch.waitSpot = null;
        ch.state = CharacterState.IDLE;
        ch.wanderTimer = 0;
        break;
      }
      // An end at our table is ours to take (officeState only offers it to the queue head)
      const end = freeSlots.find((s) => s.uid === ch.waitSpot!.uid);
      if (end) {
        const path = findPath(ch.tileCol, ch.tileRow, end.col, end.row, tileMap, blockedTiles);
        if (path.length > 0) {
          ch.waitSpot = null;
          ch.playSlot = end;
          ch.path = path;
          ch.moveProgress = 0;
          ch.state = CharacterState.WALK;
          ch.frame = 0;
          ch.frameTimer = 0;
        }
      }
      break;
    }

    case CharacterState.TYPE: {
      if (ch.frameTimer >= TYPE_FRAME_DURATION_SEC) {
        ch.frameTimer -= TYPE_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 2;
      }
      // If no longer active, stand up and start wandering (after seatTimer expires)
      if (!ch.isActive) {
        // Resting, but a table end is free → get up and play
        if (freeSlots.length > 0) {
          const end = nearest(freeSlots, ch);
          const path = findPath(ch.tileCol, ch.tileRow, end.col, end.row, tileMap, blockedTiles);
          if (path.length > 0) {
            ch.playSlot = end;
            ch.seatTimer = 0;
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
            break;
          }
        }
        if (ch.seatTimer > 0) {
          ch.seatTimer -= dt;
          break;
        }
        ch.seatTimer = 0; // clear sentinel
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        ch.wanderCount = 0;
        ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX);
      }
      break;
    }

    case CharacterState.IDLE: {
      // No idle animation — static pose
      ch.frame = 0;
      if (ch.seatTimer < 0) ch.seatTimer = 0; // clear turn-end sentinel
      // If became active, pathfind to seat
      if (ch.isActive) {
        if (!ch.seatId) {
          // No seat assigned — type in place
          ch.state = CharacterState.TYPE;
          ch.frame = 0;
          ch.frameTimer = 0;
          break;
        }
        const seat = seats.get(ch.seatId);
        if (seat) {
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            seat.seatCol,
            seat.seatRow,
            tileMap,
            blockedTiles,
          );
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
          } else {
            // Already at seat or no path — sit down
            ch.state = CharacterState.TYPE;
            ch.dir = seat.facingDir;
            ch.frame = 0;
            ch.frameTimer = 0;
          }
        }
        break;
      }
      // Countdown wander timer
      ch.wanderTimer -= dt;
      if (ch.wanderTimer <= 0) {
        // Check if we've wandered enough — return to seat for a rest
        if (ch.wanderCount >= ch.wanderLimit && ch.seatId) {
          const seat = seats.get(ch.seatId);
          if (seat) {
            const path = findPath(
              ch.tileCol,
              ch.tileRow,
              seat.seatCol,
              seat.seatRow,
              tileMap,
              blockedTiles,
            );
            if (path.length > 0) {
              ch.path = path;
              ch.moveProgress = 0;
              ch.state = CharacterState.WALK;
              ch.frame = 0;
              ch.frameTimer = 0;
              break;
            }
          }
        }
        // A game nearby? Sometimes head there instead of a random tile: take a free
        // end, or join the line beside a full table.
        if ((freeSlots.length > 0 || freeWaits.length > 0) && Math.random() < GAME_JOIN_CHANCE) {
          const end =
            freeSlots.length > 0 ? freeSlots[Math.floor(Math.random() * freeSlots.length)] : null;
          const wait = end ? null : freeWaits[Math.floor(Math.random() * freeWaits.length)];
          const target = end ?? wait!;
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            target.col,
            target.row,
            tileMap,
            blockedExcept(blockedTiles, target),
          );
          if (path.length > 0) {
            if (end) {
              ch.playSlot = end;
            } else {
              ch.waitSpot = wait;
              ch.queuedAt = ++queueTicket;
            }
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
            ch.wanderCount++;
            ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
            break;
          }
        }
        if (walkableTiles.length > 0) {
          const target = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            target.col,
            target.row,
            tileMap,
            blockedTiles,
          );
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
            ch.wanderCount++;
          }
        }
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
      }
      break;
    }

    case CharacterState.WALK: {
      // Walk animation
      if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
        ch.frameTimer -= WALK_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 4;
      }

      if (ch.path.length === 0) {
        // Path complete — snap to tile center and transition
        const center = tileCenter(ch.tileCol, ch.tileRow);
        ch.x = center.x;
        ch.y = center.y;

        if (ch.isActive) {
          ch.playSlot = null;
          ch.waitSpot = null;
          if (!ch.seatId) {
            // No seat — type in place
            ch.state = CharacterState.TYPE;
          } else {
            const seat = seats.get(ch.seatId);
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
            } else {
              ch.state = CharacterState.IDLE;
            }
          }
        } else {
          // Arrived at the claimed table end — start playing
          const slot = ch.playSlot;
          if (slot && ch.tileCol === slot.col && ch.tileRow === slot.row) {
            ch.state = CharacterState.PLAY;
            ch.dir = slot.dir;
            ch.frame = 0;
            ch.frameTimer = 0;
            break;
          }
          // Arrived at the claimed wait spot — get in line
          const wait = ch.waitSpot;
          if (wait && ch.tileCol === wait.col && ch.tileRow === wait.row) {
            ch.state = CharacterState.QUEUE;
            ch.dir = wait.dir;
            ch.frame = 0;
            ch.frameTimer = 0;
            break;
          }
          ch.playSlot = null; // walked somewhere else — release the claims
          ch.waitSpot = null;
          // Check if arrived at assigned seat — sit down for a rest before wandering again
          if (ch.seatId) {
            const seat = seats.get(ch.seatId);
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
              // seatTimer < 0 is a sentinel from setAgentActive(false) meaning
              // "turn just ended" — skip the long rest so idle transition is immediate
              if (ch.seatTimer < 0) {
                ch.seatTimer = 0;
              } else {
                ch.seatTimer = randomRange(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC);
              }
              ch.wanderCount = 0;
              ch.wanderLimit = randomInt(
                WANDER_MOVES_BEFORE_REST_MIN,
                WANDER_MOVES_BEFORE_REST_MAX,
              );
              ch.frame = 0;
              ch.frameTimer = 0;
              break;
            }
          }
          ch.state = CharacterState.IDLE;
          ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        }
        ch.frame = 0;
        ch.frameTimer = 0;
        break;
      }

      // Move toward next tile in path
      const nextTile = ch.path[0];
      ch.dir = directionBetween(ch.tileCol, ch.tileRow, nextTile.col, nextTile.row);

      ch.moveProgress += (WALK_SPEED_PX_PER_SEC / TILE_SIZE) * dt;

      const fromCenter = tileCenter(ch.tileCol, ch.tileRow);
      const toCenter = tileCenter(nextTile.col, nextTile.row);
      const t = Math.min(ch.moveProgress, 1);
      ch.x = fromCenter.x + (toCenter.x - fromCenter.x) * t;
      ch.y = fromCenter.y + (toCenter.y - fromCenter.y) * t;

      if (ch.moveProgress >= 1) {
        // Arrived at next tile
        ch.tileCol = nextTile.col;
        ch.tileRow = nextTile.row;
        ch.x = toCenter.x;
        ch.y = toCenter.y;
        ch.path.shift();
        ch.moveProgress = 0;
      }

      // If became active while wandering, repath to seat
      if (ch.isActive && ch.seatId) {
        ch.playSlot = null;
        ch.waitSpot = null;
        const seat = seats.get(ch.seatId);
        if (seat) {
          const lastStep = ch.path[ch.path.length - 1];
          if (!lastStep || lastStep.col !== seat.seatCol || lastStep.row !== seat.seatRow) {
            const newPath = findPath(
              ch.tileCol,
              ch.tileRow,
              seat.seatCol,
              seat.seatRow,
              tileMap,
              blockedTiles,
            );
            if (newPath.length > 0) {
              ch.path = newPath;
              ch.moveProgress = 0;
            }
          }
        }
      }
      break;
    }
  }
}

/** Get the correct sprite frame for a character's current state and direction */
export function getCharacterSprite(ch: Character, sprites: CharacterSprites): SpriteData {
  switch (ch.state) {
    case CharacterState.TYPE:
      if (isReadingTool(ch.currentTool)) {
        return sprites.reading[ch.dir][ch.frame % 2];
      }
      return sprites.typing[ch.dir][ch.frame % 2];
    case CharacterState.WALK:
      return sprites.walk[ch.dir][ch.frame % 4];
    case CharacterState.PLAY:
      return getPlaySprites(sprites, ch.playSlot?.game)[ch.dir][ch.frame % 2];
    case CharacterState.QUEUE:
      // Sitting on a couch while waiting, or standing in the line
      return ch.waitSpot?.seatId ? sprites.typing[ch.dir][0] : sprites.walk[ch.dir][1];
    case CharacterState.IDLE:
      return sprites.walk[ch.dir][1];
    default:
      return sprites.walk[ch.dir][1];
  }
}

function nearest<T extends { col: number; row: number }>(spots: T[], ch: Character): T {
  let best = spots[0];
  let bestD = Infinity;
  for (const s of spots) {
    const d = Math.abs(s.col - ch.tileCol) + Math.abs(s.row - ch.tileRow);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** Queue tickets: strictly increasing so the longest-waiting spectator goes first. */
let queueTicket = 0;

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
