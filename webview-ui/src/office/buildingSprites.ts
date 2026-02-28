/**
 * Building sprite instance factory — converts town building definitions into
 * FurnitureInstances for z-sorted rendering, and tracks which WALL tiles are
 * covered by building sprites (so renderTileGrid can skip them).
 *
 * Building sprites are intentionally larger than tile footprints — bottoms align
 * at the footprint's bottom edge, roofs extend above. Classic RPG visual style.
 */

import type { FurnitureInstance, SpriteData } from './types.js'
import { TILE_SIZE } from './types.js'
import type { LoadedTileset } from './tilesetLoader.js'
import { TOWN_BUILDINGS } from '../data/defaultTownLayout.js'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Building instances ready for z-sorted rendering */
let buildingInstances: FurnitureInstance[] = []

/** Set of encoded tile positions (row * MAX_COLS + col) covered by building sprites */
let coveredTiles: Set<number> | null = null

/** Encoding factor — must exceed max possible column count */
const ENCODE_FACTOR = 256

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Initialize building sprites from a loaded tileset.
 * For each town building that has a matching sprite in the tileset,
 * creates a FurnitureInstance and marks its WALL tiles as covered.
 */
export function setBuildingTileset(tileset: LoadedTileset): void {
  buildingInstances = []
  coveredTiles = new Set<number>()

  for (const building of TOWN_BUILDINGS) {
    const sprite = tileset.buildingSprites.get(building.id)
    if (!sprite) continue

    const spriteH = sprite.length
    const footprintBottomRow = building.topLeft.row + building.size.h

    // Bottom-align: sprite bottom at footprint bottom, roof extends above
    const x = building.topLeft.col * TILE_SIZE
    const y = footprintBottomRow * TILE_SIZE - spriteH

    // Z-sort at building's bottom edge (characters below this Y render in front)
    const zY = footprintBottomRow * TILE_SIZE

    buildingInstances.push({ sprite, x, y, zY })

    // Mark all WALL tiles in this building's footprint as covered
    for (let r = building.topLeft.row; r < footprintBottomRow; r++) {
      for (let c = building.topLeft.col; c < building.topLeft.col + building.size.w; c++) {
        coveredTiles.add(r * ENCODE_FACTOR + c)
      }
    }
  }

  if (buildingInstances.length > 0) {
    console.log(`[BuildingSprites] ${buildingInstances.length} building sprites loaded, ${coveredTiles.size} wall tiles covered`)
  }
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** Check if any building sprites have been loaded */
export function hasBuildingSprites(): boolean {
  return buildingInstances.length > 0
}

/** Get all building FurnitureInstances for z-sorted rendering */
export function getBuildingInstances(): FurnitureInstance[] {
  return buildingInstances
}

/** Check if a WALL tile at (col, row) is covered by a building sprite */
export function isCoveredWallTile(col: number, row: number): boolean {
  if (!coveredTiles) return false
  return coveredTiles.has(row * ENCODE_FACTOR + col)
}
