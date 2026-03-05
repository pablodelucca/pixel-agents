import { CharacterState, Direction, TILE_SIZE } from '../types.js'
import type { Character, Seat, SpriteData, TileType as TileTypeVal } from '../types.js'
import type { CharacterSprites } from '../sprites/spriteData.js'
import { findPath } from '../layout/tileMap.js'
import {
  WALK_SPEED_PX_PER_SEC,
  WALK_FRAME_DURATION_SEC,
  TYPE_FRAME_DURATION_SEC,
  WANDER_PAUSE_MIN_SEC,
  WANDER_PAUSE_MAX_SEC,
  WANDER_MOVES_BEFORE_REST_MIN,
  WANDER_MOVES_BEFORE_REST_MAX,
  SEAT_REST_MIN_SEC,
  SEAT_REST_MAX_SEC,
  VIRTUAL_MONITOR_FRAME_DURATION_SEC,
  INTERACT_CHANCE,
  INTERACT_EMOJI_DURATION_SEC,
  INTERACT_STAY_SEC_MIN,
  INTERACT_STAY_SEC_MAX,
} from '../../constants.js'
import { FURNITURE_INTERACT_EMOJIS } from '../sprites/spriteData.js'
import type { PlacedFurniture } from '../types.js'
import { getCatalogEntry } from '../layout/furnitureCatalog.js'

/** Tools that show reading animation instead of typing */
const READING_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'])

export function isReadingTool(tool: string | null): boolean {
  if (!tool) return false
  return READING_TOOLS.has(tool)
}

/** Pixel center of a tile */
function tileCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  }
}

/** Direction from one tile to an adjacent tile */
function directionBetween(fromCol: number, fromRow: number, toCol: number, toRow: number): Direction {
  const dc = toCol - fromCol
  const dr = toRow - fromRow
  if (dc > 0) return Direction.RIGHT
  if (dc < 0) return Direction.LEFT
  if (dr > 0) return Direction.DOWN
  return Direction.UP
}

export function createCharacter(
  id: number,
  palette: number,
  seatId: string | null,
  seat: Seat | null,
  hueShift = 0,
): Character {
  const col = seat ? seat.seatCol : 1
  const row = seat ? seat.seatRow : 1
  const center = tileCenter(col, row)
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
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    monitorFrame: 0,
    monitorFrameTimer: 0,
    tasks: [],
    interactTarget: null,
    interactEmoji: null,
    interactEmojiTimer: 0,
  }
}

/** Find an adjacent walkable tile next to a furniture item */
function findAdjacentTile(
  furn: PlacedFurniture,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): { col: number; row: number } | null {
  const entry = getCatalogEntry(furn.type)
  const fw = entry?.footprintW ?? 1
  const fh = entry?.footprintH ?? 1
  const rows = tileMap.length
  const cols = rows > 0 ? tileMap[0].length : 0
  // Check tiles around the furniture footprint
  const candidates: Array<{ col: number; row: number }> = []
  for (let c = furn.col - 1; c <= furn.col + fw; c++) {
    for (let r = furn.row - 1; r <= furn.row + fh; r++) {
      if (c >= furn.col && c < furn.col + fw && r >= furn.row && r < furn.row + fh) continue
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue
      if (blockedTiles.has(`${c},${r}`)) continue
      candidates.push({ col: c, row: r })
    }
  }
  if (candidates.length === 0) return null
  return candidates[Math.floor(Math.random() * candidates.length)]
}

/** Pick a random interactable furniture item */
function pickInteractableFurniture(
  furniture: PlacedFurniture[],
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): { furn: PlacedFurniture; tile: { col: number; row: number }; emojis: { going: string; arrived: string } } | null {
  // Collect furniture that has interaction emojis
  const interactable = furniture.filter(f => {
    // Match by checking if any key is a substring of the type
    for (const key of Object.keys(FURNITURE_INTERACT_EMOJIS)) {
      if (f.type.toLowerCase().includes(key)) return true
    }
    return false
  })
  if (interactable.length === 0) return null
  // Shuffle and try to find one with an adjacent walkable tile
  const shuffled = [...interactable].sort(() => Math.random() - 0.5)
  for (const furn of shuffled) {
    const tile = findAdjacentTile(furn, tileMap, blockedTiles)
    if (!tile) continue
    // Find matching emoji
    for (const [key, emojis] of Object.entries(FURNITURE_INTERACT_EMOJIS)) {
      if (furn.type.toLowerCase().includes(key)) {
        return { furn, tile, emojis }
      }
    }
  }
  return null
}

export function updateCharacter(
  ch: Character,
  dt: number,
  walkableTiles: Array<{ col: number; row: number }>,
  seats: Map<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
  furniture?: PlacedFurniture[],
): void {
  ch.frameTimer += dt

  // Update virtual monitor animation
  if (ch.isActive && ch.state === CharacterState.TYPE) {
    ch.monitorFrameTimer += dt
    if (ch.monitorFrameTimer >= VIRTUAL_MONITOR_FRAME_DURATION_SEC) {
      ch.monitorFrameTimer -= VIRTUAL_MONITOR_FRAME_DURATION_SEC
      ch.monitorFrame = (ch.monitorFrame + 1) % 3
    }
  }

  // Emoji interaction bubble countdown
  if (ch.interactEmoji && ch.interactEmojiTimer > 0) {
    ch.interactEmojiTimer -= dt
    if (ch.interactEmojiTimer <= 0) {
      ch.interactEmoji = null
      ch.interactEmojiTimer = 0
    }
  }

  // Clear interaction state when becoming active
  if (ch.isActive && ch.interactTarget) {
    ch.interactTarget = null
    ch.interactEmoji = null
    ch.interactEmojiTimer = 0
  }

  switch (ch.state) {
    case CharacterState.TYPE: {
      if (ch.frameTimer >= TYPE_FRAME_DURATION_SEC) {
        ch.frameTimer -= TYPE_FRAME_DURATION_SEC
        ch.frame = (ch.frame + 1) % 2
      }
      // If no longer active, stand up and start wandering (after seatTimer expires)
      if (!ch.isActive) {
        if (ch.seatTimer > 0) {
          ch.seatTimer -= dt
          break
        }
        ch.seatTimer = 0 // clear sentinel
        ch.state = CharacterState.IDLE
        ch.frame = 0
        ch.frameTimer = 0
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC)
        ch.wanderCount = 0
        ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX)
      }
      break
    }

    case CharacterState.IDLE: {
      // No idle animation — static pose
      ch.frame = 0
      if (ch.seatTimer < 0) ch.seatTimer = 0 // clear turn-end sentinel
      // If became active, pathfind to seat
      if (ch.isActive) {
        if (!ch.seatId) {
          // No seat assigned — type in place
          ch.state = CharacterState.TYPE
          ch.frame = 0
          ch.frameTimer = 0
          break
        }
        const seat = seats.get(ch.seatId)
        if (seat) {
          const path = findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles)
          if (path.length > 0) {
            ch.path = path
            ch.moveProgress = 0
            ch.state = CharacterState.WALK
            ch.frame = 0
            ch.frameTimer = 0
          } else {
            // Already at seat or no path — sit down
            ch.state = CharacterState.TYPE
            ch.dir = seat.facingDir
            ch.frame = 0
            ch.frameTimer = 0
          }
        }
        break
      }
      // Countdown wander timer
      ch.wanderTimer -= dt
      if (ch.wanderTimer <= 0) {
        // Check if we've wandered enough — return to seat for a rest
        if (ch.wanderCount >= ch.wanderLimit && ch.seatId) {
          const seat = seats.get(ch.seatId)
          if (seat) {
            const path = findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles)
            if (path.length > 0) {
              ch.path = path
              ch.moveProgress = 0
              ch.state = CharacterState.WALK
              ch.frame = 0
              ch.frameTimer = 0
              break
            }
          }
        }
        // Try to interact with furniture
        let didInteract = false
        if (furniture && Math.random() < INTERACT_CHANCE) {
          const target = pickInteractableFurniture(furniture, tileMap, blockedTiles)
          if (target) {
            const path = findPath(ch.tileCol, ch.tileRow, target.tile.col, target.tile.row, tileMap, blockedTiles)
            if (path.length > 0) {
              ch.path = path
              ch.moveProgress = 0
              ch.state = CharacterState.WALK
              ch.frame = 0
              ch.frameTimer = 0
              ch.wanderCount++
              ch.interactTarget = { uid: target.furn.uid, col: target.tile.col, row: target.tile.row }
              ch.interactEmoji = target.emojis.going
              ch.interactEmojiTimer = INTERACT_EMOJI_DURATION_SEC
              didInteract = true
            }
          }
        }
        if (!didInteract && walkableTiles.length > 0) {
          const target = walkableTiles[Math.floor(Math.random() * walkableTiles.length)]
          const path = findPath(ch.tileCol, ch.tileRow, target.col, target.row, tileMap, blockedTiles)
          if (path.length > 0) {
            ch.path = path
            ch.moveProgress = 0
            ch.state = CharacterState.WALK
            ch.frame = 0
            ch.frameTimer = 0
            ch.wanderCount++
          }
        }
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC)
      }
      break
    }

    case CharacterState.WALK: {
      // Walk animation
      if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
        ch.frameTimer -= WALK_FRAME_DURATION_SEC
        ch.frame = (ch.frame + 1) % 4
      }

      if (ch.path.length === 0) {
        // Path complete — snap to tile center and transition
        const center = tileCenter(ch.tileCol, ch.tileRow)
        ch.x = center.x
        ch.y = center.y

        if (ch.isActive) {
          if (!ch.seatId) {
            // No seat — type in place
            ch.state = CharacterState.TYPE
          } else {
            const seat = seats.get(ch.seatId)
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE
              ch.dir = seat.facingDir
            } else {
              ch.state = CharacterState.IDLE
            }
          }
        } else {
          // Check if arrived at furniture interaction target
          if (ch.interactTarget && ch.tileCol === ch.interactTarget.col && ch.tileRow === ch.interactTarget.row) {
            // Find the matching furniture to get the arrived emoji
            if (furniture) {
              const furn = furniture.find(f => f.uid === ch.interactTarget!.uid)
              if (furn) {
                for (const [key, emojis] of Object.entries(FURNITURE_INTERACT_EMOJIS)) {
                  if (furn.type.toLowerCase().includes(key)) {
                    ch.interactEmoji = emojis.arrived
                    ch.interactEmojiTimer = INTERACT_EMOJI_DURATION_SEC
                    break
                  }
                }
                // Face the furniture
                const furnCenterCol = furn.col + ((getCatalogEntry(furn.type)?.footprintW ?? 1) - 1) / 2
                const furnCenterRow = furn.row + ((getCatalogEntry(furn.type)?.footprintH ?? 1) - 1) / 2
                const dc = furnCenterCol - ch.tileCol
                const dr = furnCenterRow - ch.tileRow
                if (Math.abs(dc) > Math.abs(dr)) {
                  ch.dir = dc > 0 ? Direction.RIGHT : Direction.LEFT
                } else {
                  ch.dir = dr > 0 ? Direction.DOWN : Direction.UP
                }
              }
            }
            ch.interactTarget = null
            ch.state = CharacterState.IDLE
            ch.wanderTimer = randomRange(INTERACT_STAY_SEC_MIN, INTERACT_STAY_SEC_MAX)
            ch.frame = 0
            ch.frameTimer = 0
            break
          }
          // Check if arrived at assigned seat — sit down for a rest before wandering again
          if (ch.seatId) {
            const seat = seats.get(ch.seatId)
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE
              ch.dir = seat.facingDir
              // seatTimer < 0 is a sentinel from setAgentActive(false) meaning
              // "turn just ended" — skip the long rest so idle transition is immediate
              if (ch.seatTimer < 0) {
                ch.seatTimer = 0
              } else {
                ch.seatTimer = randomRange(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC)
              }
              ch.wanderCount = 0
              ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX)
              ch.frame = 0
              ch.frameTimer = 0
              break
            }
          }
          ch.state = CharacterState.IDLE
          ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC)
        }
        ch.frame = 0
        ch.frameTimer = 0
        break
      }

      // Move toward next tile in path
      const nextTile = ch.path[0]
      ch.dir = directionBetween(ch.tileCol, ch.tileRow, nextTile.col, nextTile.row)

      ch.moveProgress += (WALK_SPEED_PX_PER_SEC / TILE_SIZE) * dt

      const fromCenter = tileCenter(ch.tileCol, ch.tileRow)
      const toCenter = tileCenter(nextTile.col, nextTile.row)
      const t = Math.min(ch.moveProgress, 1)
      ch.x = fromCenter.x + (toCenter.x - fromCenter.x) * t
      ch.y = fromCenter.y + (toCenter.y - fromCenter.y) * t

      if (ch.moveProgress >= 1) {
        // Arrived at next tile
        ch.tileCol = nextTile.col
        ch.tileRow = nextTile.row
        ch.x = toCenter.x
        ch.y = toCenter.y
        ch.path.shift()
        ch.moveProgress = 0
      }

      // If became active while wandering, repath to seat
      if (ch.isActive && ch.seatId) {
        const seat = seats.get(ch.seatId)
        if (seat) {
          const lastStep = ch.path[ch.path.length - 1]
          if (!lastStep || lastStep.col !== seat.seatCol || lastStep.row !== seat.seatRow) {
            const newPath = findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles)
            if (newPath.length > 0) {
              ch.path = newPath
              ch.moveProgress = 0
            }
          }
        }
      }
      break
    }
  }
}

/** Get the correct sprite frame for a character's current state and direction */
export function getCharacterSprite(ch: Character, sprites: CharacterSprites): SpriteData {
  switch (ch.state) {
    case CharacterState.TYPE:
      if (isReadingTool(ch.currentTool)) {
        return sprites.reading[ch.dir][ch.frame % 2]
      }
      return sprites.typing[ch.dir][ch.frame % 2]
    case CharacterState.WALK:
      return sprites.walk[ch.dir][ch.frame % 4]
    case CharacterState.IDLE:
      return sprites.walk[ch.dir][1]
    default:
      return sprites.walk[ch.dir][1]
  }
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}
