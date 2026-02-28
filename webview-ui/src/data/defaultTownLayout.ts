import { TileType } from '../office/types.js'
import type { OfficeLayout } from '../office/types.js'

// Simple town layout for PC-FORK proof of concept
// FLOOR_1 = grass (walkable), FLOOR_2 = path (walkable), WALL = building (not walkable)
// 20 cols x 15 rows — small enough to see the whole town, big enough for movement testing

const COLS = 20
const ROWS = 15

// G = grass, P = path, B = building (wall)
const G = TileType.FLOOR_1
const P = TileType.FLOOR_2
const B = TileType.WALL

// prettier-ignore
const tileGrid: number[][] = [
  // col: 0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15 16 17 18 19
  /* 0 */[G, G, G, G, G, G, G, G, G, P, P, G, G, G, G, G, G, G, G, G],
  /* 1 */[G, G, G, G, G, G, G, G, G, P, P, G, G, G, G, G, G, G, G, G],
  /* 2 */[G, G, B, B, B, G, G, G, G, P, P, G, G, G, B, B, B, B, G, G],
  /* 3 */[G, G, B, B, B, G, G, G, G, P, P, G, G, G, B, B, B, B, G, G],
  /* 4 */[G, G, B, B, B, G, G, G, G, P, P, G, G, G, B, B, B, B, G, G],
  /* 5 */[G, G, G, P, G, G, G, G, G, P, P, G, G, G, G, P, G, G, G, G],
  /* 6 */[P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P],
  /* 7 */[G, G, G, G, G, G, G, B, B, B, B, B, B, G, G, G, G, G, G, G],
  /* 8 */[G, G, G, G, G, G, G, B, B, B, B, B, B, G, G, G, G, G, G, G],
  /* 9 */[G, G, G, G, G, G, G, B, B, B, B, B, B, G, G, G, G, G, G, G],
  /*10 */[G, G, G, G, G, G, G, B, B, B, B, B, B, G, G, G, G, G, G, G],
  /*11 */[G, G, B, B, G, G, G, G, G, P, P, G, G, G, G, B, B, B, G, G],
  /*12 */[G, G, B, B, G, G, G, G, G, P, P, G, G, G, G, B, B, B, G, G],
  /*13 */[G, G, G, P, G, G, G, G, G, P, P, G, G, G, G, G, P, G, G, G],
  /*14 */[G, G, G, G, G, G, G, G, G, P, P, G, G, G, G, G, G, G, G, G],
]

// Flatten to 1D array (row-major order) as expected by OfficeLayout
const tiles: number[] = tileGrid.flat()

export const defaultTownLayout: OfficeLayout = {
  version: 1,
  cols: COLS,
  rows: ROWS,
  tiles: tiles as TileType[],
  furniture: [], // No furniture in town mode — buildings are tile-based
}

// Player spawns on the path in front of the Town Hall (center building)
export const PLAYER_SPAWN_COL = 9
export const PLAYER_SPAWN_ROW = 6

// Building metadata (for future use — dialogue, names, etc.)
export const TOWN_BUILDINGS = [
  { id: 'origin_hall', name: 'Origin Hall', construct: 'LoreForged', topLeft: { col: 2, row: 2 }, size: { w: 3, h: 3 } },
  { id: 'lena_cathedral', name: "Lena's Cathedral", construct: 'Lena', topLeft: { col: 14, row: 2 }, size: { w: 4, h: 3 } },
  { id: 'town_hall', name: 'Town Hall', construct: 'Mark95', topLeft: { col: 7, row: 7 }, size: { w: 6, h: 4 } },
  { id: 'pyrosage_hearth', name: "Pyrosage's Hearth", construct: 'Pyrosage', topLeft: { col: 2, row: 11 }, size: { w: 2, h: 2 } },
  { id: 'venture_office', name: "Venture's Office", construct: 'Venture', topLeft: { col: 15, row: 11 }, size: { w: 3, h: 2 } },
]
