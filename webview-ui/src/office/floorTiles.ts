/**
 * Floor tile pattern storage and caching.
 *
 * Two rendering modes:
 * 1. **Grayscale mode** (default): Loads 7 grayscale patterns from floors.png,
 *    colorizes via HSL (Photoshop-style Colorize). Used when no tileset is available.
 * 2. **Tileset mode**: Loads pre-colored sprites from a PNG tileset via tilesetLoader.
 *    Skips colorization — sprites have their own colors. Supports per-tile-type
 *    variants (e.g., 3 grass sprites for visual variety).
 */

import type { SpriteData, FloorColor, TileType } from './types.js'
import { getColorizedSprite, clearColorizeCache } from './colorize.js'
import { TILE_SIZE, FALLBACK_FLOOR_COLOR } from '../constants.js'
import type { LoadedTileset } from './tilesetLoader.js'
import { getMappedSprites } from './tilesetLoader.js'

/** Default solid gray 16×16 tile used when floors.png is not loaded */
const DEFAULT_FLOOR_SPRITE: SpriteData = Array.from(
  { length: TILE_SIZE },
  () => Array(TILE_SIZE).fill(FALLBACK_FLOOR_COLOR) as string[],
)

/** Module-level storage for floor tile sprites (set once on load) */
let floorSprites: SpriteData[] = []

// ---------------------------------------------------------------------------
// Tileset mode state
// ---------------------------------------------------------------------------

/** Whether tileset mode is active (pre-colored PNG sprites instead of grayscale) */
let tilesetActive = false

/** Tileset sprites per TileType name → array of variants (for variety) */
const tilesetFloorMap = new Map<string, SpriteData[]>()

/** TileType enum names keyed by value — maps TileType.FLOOR_1 (1) → "FLOOR_1" */
const TILE_TYPE_NAMES: Record<number, string> = {
  1: 'FLOOR_1', 2: 'FLOOR_2', 3: 'FLOOR_3', 4: 'FLOOR_4',
  5: 'FLOOR_5', 6: 'FLOOR_6', 7: 'FLOOR_7',
}

/** Wall color constant */
export const WALL_COLOR = '#3A3A5C'

/** Set floor tile sprites (called once when extension sends floorTilesLoaded) */
export function setFloorSprites(sprites: SpriteData[]): void {
  floorSprites = sprites
  clearColorizeCache()
}

/**
 * Activate tileset mode — load pre-colored sprites from a tileset.
 * Replaces grayscale colorization with direct PNG tile rendering.
 */
export function setTilesetFloorSprites(tileset: LoadedTileset): void {
  tilesetFloorMap.clear()
  for (const typeName of Object.keys(TILE_TYPE_NAMES).map(k => TILE_TYPE_NAMES[Number(k)]!)) {
    const sprites = getMappedSprites(tileset, typeName)
    if (sprites.length > 0) {
      tilesetFloorMap.set(typeName, sprites)
    }
  }
  tilesetActive = tilesetFloorMap.size > 0
  if (tilesetActive) {
    console.log(`[FloorTiles] Tileset mode active — ${tilesetFloorMap.size} tile types mapped`)
  }
}

/** Check if tileset mode is active */
export function isTilesetActive(): boolean {
  return tilesetActive
}

/**
 * Get a tileset floor sprite for a given tile type and grid position.
 * Uses deterministic variant selection based on (col, row) for variety.
 * Returns null if no tileset sprite exists for this tile type.
 */
export function getTilesetFloorSprite(tileType: TileType, col: number, row: number): SpriteData | null {
  if (!tilesetActive) return null
  const typeName = TILE_TYPE_NAMES[tileType as number]
  if (!typeName) return null
  const variants = tilesetFloorMap.get(typeName)
  if (!variants || variants.length === 0) return null
  // Deterministic variety: hash grid position to pick variant
  const variantIdx = Math.abs((col * 31 + row * 17) % variants.length)
  return variants[variantIdx]!
}

/** Get the raw (grayscale) floor sprite for a pattern index (1-7 -> array index 0-6).
 *  Falls back to the default solid gray tile when floors.png is not loaded. */
export function getFloorSprite(patternIndex: number): SpriteData | null {
  const idx = patternIndex - 1
  if (idx < 0) return null
  if (idx < floorSprites.length) return floorSprites[idx]
  // No PNG sprites loaded — return default solid tile for any valid pattern index
  if (floorSprites.length === 0 && patternIndex >= 1) return DEFAULT_FLOOR_SPRITE
  return null
}

/** Check if floor sprites are available (always true — falls back to default solid tile) */
export function hasFloorSprites(): boolean {
  return true
}

/** Get count of available floor patterns (at least 1 for the default solid tile) */
export function getFloorPatternCount(): number {
  return floorSprites.length > 0 ? floorSprites.length : 1
}

/** Get all floor sprites (for preview rendering, falls back to default solid tile) */
export function getAllFloorSprites(): SpriteData[] {
  return floorSprites.length > 0 ? floorSprites : [DEFAULT_FLOOR_SPRITE]
}

/**
 * Get a colorized version of a floor sprite.
 * Uses Photoshop-style Colorize: grayscale -> HSL with given hue/saturation,
 * then brightness/contrast adjustment.
 */
export function getColorizedFloorSprite(patternIndex: number, color: FloorColor): SpriteData {
  const key = `floor-${patternIndex}-${color.h}-${color.s}-${color.b}-${color.c}`

  const base = getFloorSprite(patternIndex)
  if (!base) {
    // Return a 16x16 magenta error tile
    const err: SpriteData = Array.from({ length: 16 }, () => Array(16).fill('#FF00FF'))
    return err
  }

  // Floor tiles are always colorized (grayscale patterns need Photoshop-style Colorize)
  return getColorizedSprite(key, base, { ...color, colorize: true })
}
