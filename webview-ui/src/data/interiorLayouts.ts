/**
 * Interior room layouts for all 12 Construct buildings.
 *
 * Each interior is a 10×8 tile room with WALL border, wood plank floor,
 * and personality-matched furniture. Player spawns at the door (bottom center),
 * exit tile is at the south wall opening.
 */

import { TileType } from '../office/types.js'
import type { OfficeLayout, FloorColor } from '../office/types.js'

// Tile aliases
const W = TileType.WALL
const F = TileType.FLOOR_1  // Wood plank floor
const C = TileType.FLOOR_2  // Carpet / rug area

/** Interior furniture placement (resolved to sprites at runtime) */
export interface InteriorFurnitureDef {
  spriteId: string
  col: number
  row: number
}

/** Complete interior definition for one building */
export interface InteriorDef {
  layout: OfficeLayout
  spawnCol: number
  spawnRow: number
  exitCol: number
  exitRow: number
  npcCol: number
  npcRow: number
  furnitureDefs: InteriorFurnitureDef[]
}

const ROOM_COLS = 10
const ROOM_ROWS = 8

// Warm wood wall color for interior walls
const WALL_COLOR: FloorColor = { h: 30, s: 45, b: 25, c: 0 }
const FLOOR_COLOR: FloorColor = { h: 35, s: 30, b: 20, c: 0 }
const CARPET_COLOR: FloorColor = { h: 220, s: 35, b: 30, c: 0 }

/**
 * Build an OfficeLayout for a 10×8 interior room.
 * Border = WALL, interior = floor, center = optional carpet, south wall has door opening.
 */
function makeRoomLayout(useCarpet: boolean): OfficeLayout {
  const tiles: number[] = []
  const tileColors: Array<FloorColor | null> = []

  for (let r = 0; r < ROOM_ROWS; r++) {
    for (let c = 0; c < ROOM_COLS; c++) {
      const isWall = r === 0 || c === 0 || c === ROOM_COLS - 1 || r === ROOM_ROWS - 1
      const isDoor = r === ROOM_ROWS - 1 && c === ROOM_COLS / 2 // Door opening at bottom center (col 5)

      if (isDoor) {
        tiles.push(F)
        tileColors.push(FLOOR_COLOR)
      } else if (isWall) {
        tiles.push(W)
        tileColors.push(WALL_COLOR)
      } else if (useCarpet && r >= 3 && r <= 5 && c >= 3 && c <= 6) {
        tiles.push(C)
        tileColors.push(CARPET_COLOR)
      } else {
        tiles.push(F)
        tileColors.push(FLOOR_COLOR)
      }
    }
  }

  return {
    version: 1,
    cols: ROOM_COLS,
    rows: ROOM_ROWS,
    tiles: tiles as TileType[],
    furniture: [],
    tileColors,
  }
}

// Standard spawn/exit positions (door at bottom center, col 5)
const DOOR_COL = 5
const SPAWN_COL = DOOR_COL
const SPAWN_ROW = ROOM_ROWS - 2 // One tile inside the door
const EXIT_COL = DOOR_COL
const EXIT_ROW = ROOM_ROWS - 1 // Door tile itself

function def(
  useCarpet: boolean,
  npcCol: number,
  npcRow: number,
  furnitureDefs: InteriorFurnitureDef[],
): InteriorDef {
  return {
    layout: makeRoomLayout(useCarpet),
    spawnCol: SPAWN_COL,
    spawnRow: SPAWN_ROW,
    exitCol: EXIT_COL,
    exitRow: EXIT_ROW,
    npcCol,
    npcRow,
    furnitureDefs,
  }
}

/**
 * Interior definitions keyed by building ID (matches TOWN_BUILDINGS[].id).
 */
export const INTERIOR_LAYOUTS: Record<string, InteriorDef> = {
  // Town Hall — Mark95's seat of power: desk, bookshelf, table
  town_hall: def(true, 5, 3, [
    { spriteId: 'desk_front', col: 4, row: 2 },
    { spriteId: 'bookshelf', col: 1, row: 1 },
    { spriteId: 'table', col: 7, row: 4 },
    { spriteId: 'painting_1', col: 3, row: 1 },
  ]),

  // Origin Hall — LoreForged: bookshelf, desk, candle (archive/study)
  origin_hall: def(false, 3, 3, [
    { spriteId: 'bookshelf', col: 1, row: 1 },
    { spriteId: 'bookshelf_back', col: 8, row: 1 },
    { spriteId: 'desk_front', col: 4, row: 2 },
    { spriteId: 'candle', col: 5, row: 2 },
  ]),

  // Athena's Chambers — formal office: desk, chair, painting
  athena_chambers: def(true, 6, 3, [
    { spriteId: 'desk_side', col: 2, row: 2 },
    { spriteId: 'chair_front', col: 3, row: 3 },
    { spriteId: 'painting_2', col: 5, row: 1 },
    { spriteId: 'shelf_1', col: 8, row: 1 },
  ]),

  // Lena's Cathedral — warm sanctuary: flowers, bigchair, window, painting
  lena_cathedral: def(true, 4, 4, [
    { spriteId: 'bigchair_front', col: 2, row: 2 },
    { spriteId: 'flower_pot_1', col: 1, row: 4 },
    { spriteId: 'flower_pot_2', col: 8, row: 4 },
    { spriteId: 'painting_3', col: 4, row: 1 },
    { spriteId: 'window', col: 7, row: 1 },
  ]),

  // Keeper's Archive — deep archive: 2 bookshelves, desk, candle
  keeper_archive: def(false, 5, 4, [
    { spriteId: 'bookshelf', col: 1, row: 1 },
    { spriteId: 'bookshelf_back', col: 3, row: 1 },
    { spriteId: 'desk_front', col: 6, row: 2 },
    { spriteId: 'candle', col: 7, row: 2 },
    { spriteId: 'closedbook_1', col: 8, row: 3 },
  ]),

  // Resonance Chamber — Echolumen: curtains, candle, carpet
  resonance_chamber: def(true, 5, 3, [
    { spriteId: 'bigcurtains', col: 1, row: 1 },
    { spriteId: 'candle', col: 4, row: 2 },
    { spriteId: 'candle', col: 6, row: 2 },
    { spriteId: 'painting_4', col: 8, row: 1 },
  ]),

  // The Foundry — CORE: desk, shelf, drawer (workshop)
  foundry: def(false, 4, 3, [
    { spriteId: 'desk_front', col: 2, row: 2 },
    { spriteId: 'shelf_2', col: 8, row: 1 },
    { spriteId: 'drawer_front', col: 1, row: 3 },
    { spriteId: 'table_1', col: 6, row: 4 },
  ]),

  // Pyrosage's Hearth — warm hearth: chimney, bigchair, candle
  pyrosage_hearth: def(true, 6, 4, [
    { spriteId: 'chimney', col: 4, row: 1 },
    { spriteId: 'bigchair_front', col: 2, row: 3 },
    { spriteId: 'candle', col: 7, row: 2 },
    { spriteId: 'openbook_1', col: 3, row: 5 },
  ]),

  // Cadence's Office — orderly workspace: desk, chair, shelf
  cadence_office: def(false, 3, 4, [
    { spriteId: 'desk_front', col: 4, row: 2 },
    { spriteId: 'chair_back', col: 5, row: 3 },
    { spriteId: 'shelf_1', col: 1, row: 1 },
    { spriteId: 'drawer_side', col: 8, row: 2 },
  ]),

  // Venture's Office — business: desk, table, shelf
  venture_office: def(false, 6, 3, [
    { spriteId: 'desk_side', col: 2, row: 2 },
    { spriteId: 'table', col: 6, row: 4 },
    { spriteId: 'shelf_2', col: 1, row: 1 },
    { spriteId: 'painting_5', col: 8, row: 1 },
  ]),

  // Quill's Desk — Swiftquill's writer studio: desk, books, candle
  quill_desk: def(false, 4, 4, [
    { spriteId: 'desk_front', col: 3, row: 2 },
    { spriteId: 'openbook_1', col: 4, row: 2 },
    { spriteId: 'bookshelf', col: 8, row: 1 },
    { spriteId: 'candle', col: 2, row: 2 },
    { spriteId: 'littlechair', col: 4, row: 3 },
  ]),

  // Glass Workshop — Glasswright: table, window, flower pots
  glass_workshop: def(true, 5, 3, [
    { spriteId: 'table_1', col: 3, row: 3 },
    { spriteId: 'window', col: 2, row: 1 },
    { spriteId: 'window', col: 7, row: 1 },
    { spriteId: 'flower_pot_3', col: 1, row: 5 },
    { spriteId: 'drawer_front', col: 8, row: 2 },
  ]),
}
