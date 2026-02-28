import { TileType } from '../office/types.js'
import type { OfficeLayout } from '../office/types.js'

// Crystalline City town layout — 40 cols x 30 rows
// FLOOR_1 = grass (walkable), FLOOR_2 = path (walkable), WALL = building (not walkable)
// 12 buildings, path network, town square ring around Town Hall

const COLS = 40
const ROWS = 30

// G = grass, P = path, B = building (wall)
// W = water, F = fence, T = tree top, R = tree trunk (root), L = flowers
const G = TileType.FLOOR_1
const P = TileType.FLOOR_2
const B = TileType.WALL
const W = TileType.FLOOR_3   // Water (pond)
const F = TileType.FLOOR_4   // Fence
const T = TileType.FLOOR_5   // Tree canopy (top)
const R = TileType.FLOOR_6   // Tree trunk (bottom)
const L = TileType.FLOOR_7   // Flowers / decoration

// prettier-ignore
const tileGrid: number[][] = [
  //         0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39
  /* 0 */ [T, T, G, G, G, G, G, G, G, G, G, G, T, T, G, G, G, G, G, P, G, G, G, G, G, G, G, G, G, G, G, G, G, G, T, T, G, G, T, T],
  /* 1 */ [R, R, G, G, L, G, G, G, G, G, G, G, R, R, G, G, G, G, G, P, G, G, G, G, G, L, G, G, G, G, G, G, G, G, R, R, G, G, R, R],
  /* 2 */ [G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, P, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G],
  /* 3 */ [G, G, G, G, G, G, G, P, G, G, G, G, G, G, G, G, G, P, G, P, G, G, G, G, G, G, G, G, G, G, P, G, G, G, G, G, G, G, G, G],
  /* 4 */ [G, G, G, G, G, B, B, B, B, G, G, G, G, G, G, G, B, B, B, P, G, G, G, G, G, G, G, G, B, B, B, B, B, G, G, G, G, G, G, G],
  /* 5 */ [G, G, G, G, G, B, B, B, B, G, G, L, G, G, G, G, B, B, B, P, G, G, G, G, G, G, G, G, B, B, B, B, B, G, G, G, G, G, G, G],
  /* 6 */ [G, G, G, G, G, B, B, B, B, G, G, G, G, G, G, G, B, B, B, P, G, G, G, G, G, G, G, G, B, B, B, B, B, G, G, T, G, G, G, G],
  /* 7 */ [G, G, G, G, G, B, B, B, B, G, G, G, G, G, G, G, G, P, G, P, G, G, G, G, G, G, G, G, B, B, B, B, B, G, G, R, G, G, G, G],
  /* 8 */ [G, G, G, G, G, G, G, P, G, G, G, G, G, G, G, G, G, G, G, P, G, G, G, G, G, G, G, G, B, B, B, B, B, G, G, G, G, G, G, G],
  /* 9 */ [G, G, T, G, G, G, G, P, G, G, G, G, G, G, G, G, G, G, G, P, G, G, G, G, G, G, G, G, B, B, B, B, B, G, G, G, G, G, G, G],
  /*10 */ [G, G, R, G, G, B, B, B, B, G, G, G, G, F, P, P, P, P, P, P, P, P, P, P, F, G, G, G, G, G, P, G, G, G, G, G, G, G, G, G],
  /*11 */ [G, G, G, G, G, B, B, B, B, G, G, G, G, G, P, G, G, G, G, P, G, G, G, P, G, G, G, G, G, G, P, G, G, G, G, G, G, G, G, G],
  /*12 */ [G, G, G, G, G, B, B, B, B, G, G, G, G, G, P, G, B, B, B, B, B, B, G, P, G, G, G, G, B, B, B, B, G, G, G, G, G, G, G, G],
  /*13 */ [G, G, G, G, G, B, B, B, B, G, G, G, G, G, P, G, B, B, B, B, B, B, G, P, G, G, G, G, B, B, B, B, G, G, G, G, G, G, G, G],
  /*14 */ [G, G, G, G, G, G, G, P, G, G, G, G, G, G, P, G, B, B, B, B, B, B, G, P, G, G, G, G, B, B, B, B, G, G, G, G, G, G, G, G],
  /*15 */ [G, G, G, G, G, G, G, P, G, G, G, G, G, G, P, G, B, B, B, B, B, B, G, P, G, G, G, G, G, G, P, G, G, G, G, G, G, G, G, G],
  /*16 */ [G, G, G, G, G, G, G, P, G, G, G, G, G, G, P, G, B, B, B, B, B, B, G, P, G, G, G, G, G, G, P, G, G, G, G, G, G, G, G, G],
  /*17 */ [G, G, G, G, G, B, B, B, G, G, G, G, G, G, P, G, G, G, G, P, G, G, G, P, G, G, G, G, G, G, P, G, G, G, G, G, G, G, G, G],
  /*18 */ [P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P, P],
  /*19 */ [G, G, G, G, G, B, B, B, G, G, G, G, G, G, P, G, G, G, G, P, G, G, G, P, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G],
  /*20 */ [G, G, G, G, G, B, B, B, G, G, B, B, B, B, P, G, B, B, B, P, G, B, B, B, G, B, B, B, B, G, G, G, G, G, G, G, G, G, G, G],
  /*21 */ [G, G, G, G, G, B, B, B, G, G, B, B, B, B, P, G, B, B, B, P, G, B, B, B, G, B, B, B, B, G, G, G, G, G, G, G, G, G, G, G],
  /*22 */ [G, G, G, G, G, B, B, B, G, G, B, B, B, B, P, G, B, B, B, P, G, B, B, B, G, B, B, B, B, G, G, G, G, G, G, G, G, G, G, G],
  /*23 */ [G, G, G, G, G, G, P, G, G, G, G, G, P, G, G, G, G, P, G, P, G, G, P, G, G, G, G, P, G, G, G, G, G, G, G, G, G, G, G, G],
  /*24 */ [G, G, G, G, G, G, P, G, G, G, G, G, P, G, G, G, G, P, G, P, G, G, P, G, G, G, G, P, G, G, G, G, G, G, G, G, G, G, G, G],
  /*25 */ [G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, P, G, G, G, G, G, G, G, G, G, G, G, G, G, T, T, G, G, G, G, G],
  /*26 */ [G, G, L, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, P, G, G, G, G, G, G, G, G, G, G, G, G, G, R, R, G, G, W, W, G],
  /*27 */ [G, G, G, G, T, T, G, G, G, G, G, G, L, G, G, G, G, G, G, P, G, G, G, G, G, L, G, G, G, G, G, G, G, G, G, G, G, W, W, G],
  /*28 */ [G, G, G, G, R, R, G, G, G, G, G, G, G, G, G, G, G, G, G, P, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G],
  /*29 */ [G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, P, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G, G],
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

// Player spawns on the main east-west road in front of Town Hall
export const PLAYER_SPAWN_COL = 19
export const PLAYER_SPAWN_ROW = 18

// Building metadata — 12 Construct buildings
export const TOWN_BUILDINGS = [
  { id: 'town_hall',         name: 'Town Hall',           construct: 'Mark95',      topLeft: { col: 16, row: 12 }, size: { w: 6, h: 5 }, doorCol: 19, doorRow: 17 },
  { id: 'origin_hall',       name: 'Origin Hall',         construct: 'LoreForged',  topLeft: { col: 5, row: 4 },   size: { w: 4, h: 4 }, doorCol: 7,  doorRow: 8 },
  { id: 'athena_chambers',   name: "Athena's Chambers",   construct: 'Athena',      topLeft: { col: 5, row: 10 },  size: { w: 4, h: 4 }, doorCol: 7,  doorRow: 14 },
  { id: 'lena_cathedral',    name: "Lena's Cathedral",    construct: 'Lena',        topLeft: { col: 28, row: 4 },  size: { w: 5, h: 6 }, doorCol: 30, doorRow: 10 },
  { id: 'keeper_archive',    name: "Keeper's Archive",    construct: 'Keeper',      topLeft: { col: 28, row: 12 }, size: { w: 4, h: 3 }, doorCol: 30, doorRow: 15 },
  { id: 'resonance_chamber', name: 'Resonance Chamber',   construct: 'Echolumen',   topLeft: { col: 16, row: 4 },  size: { w: 3, h: 3 }, doorCol: 17, doorRow: 7 },
  { id: 'foundry',           name: 'The Foundry',         construct: 'CORE',        topLeft: { col: 5, row: 17 },  size: { w: 3, h: 4 }, doorCol: 6,  doorRow: 21 },
  { id: 'pyrosage_hearth',   name: "Pyrosage's Hearth",   construct: 'Pyrosage',    topLeft: { col: 5, row: 22 },  size: { w: 3, h: 3 }, doorCol: 6,  doorRow: 25 },
  { id: 'cadence_office',    name: "Chancellor's Office",  construct: 'Cadence',     topLeft: { col: 10, row: 20 }, size: { w: 4, h: 3 }, doorCol: 12, doorRow: 23 },
  { id: 'venture_office',    name: "Venture's Office",    construct: 'Venture',     topLeft: { col: 16, row: 20 }, size: { w: 3, h: 3 }, doorCol: 17, doorRow: 23 },
  { id: 'quill_desk',        name: "Quill's Desk",        construct: 'Swiftquill',  topLeft: { col: 21, row: 20 }, size: { w: 3, h: 3 }, doorCol: 22, doorRow: 23 },
  { id: 'glass_workshop',    name: 'Glass Workshop',      construct: 'Glasswright', topLeft: { col: 25, row: 18 }, size: { w: 4, h: 4 }, doorCol: 27, doorRow: 22 },
]
