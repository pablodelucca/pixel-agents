/**
 * Interior furniture sprite registry — loads interior PNGs from tileset
 * and provides them as FurnitureInstances for z-sorted rendering inside buildings.
 */

import type { SpriteData, FurnitureInstance } from './types.js'
import { TILE_SIZE } from './types.js'
import type { LoadedTileset } from './tilesetLoader.js'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let interiorSpriteMap: Map<string, SpriteData> = new Map()

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Store interior sprites from a loaded tileset */
export function setInteriorTileset(tileset: LoadedTileset): void {
  interiorSpriteMap = tileset.interiorSprites
  if (interiorSpriteMap.size > 0) {
    console.log(`[InteriorSprites] ${interiorSpriteMap.size} interior sprites available`)
  }
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function hasInteriorSprites(): boolean {
  return interiorSpriteMap.size > 0
}

export function getInteriorSprite(id: string): SpriteData | null {
  return interiorSpriteMap.get(id) ?? null
}

/**
 * Build a FurnitureInstance for an interior sprite placed at (col, row).
 * Sprite bottom-aligns at the tile position (same as building sprites).
 */
export function createInteriorFurnitureInstance(
  spriteId: string,
  col: number,
  row: number,
): FurnitureInstance | null {
  const sprite = interiorSpriteMap.get(spriteId)
  if (!sprite) return null

  const spriteH = sprite.length
  const x = col * TILE_SIZE
  const y = (row + 1) * TILE_SIZE - spriteH // bottom-align to tile
  const zY = (row + 1) * TILE_SIZE

  return { sprite, x, y, zY }
}
