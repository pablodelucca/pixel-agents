/**
 * tilesetLoader — Load a PNG sprite sheet tileset and extract tiles as SpriteData.
 *
 * Reads a tileset.json metadata file, loads referenced PNG sprite sheets,
 * extracts individual 16×16 tiles via offscreen canvas, and converts them
 * to the hex-color SpriteData format used by the existing rendering pipeline.
 *
 * This is the bridge between external art packs and the programmatic renderer.
 */

import type { SpriteData } from './types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SheetDef {
  file: string
  cols: number
  rows: number
}

interface TileRef {
  sheet: string
  col: number
  row: number
}

export interface TilesetConfig {
  name: string
  tileSize: number
  sheets: Record<string, SheetDef>
  tiles: Record<string, TileRef>
  mapping: Record<string, string[]>
  buildings?: Record<string, { file: string }>
}

export interface LoadedTileset {
  config: TilesetConfig
  sprites: Map<string, SpriteData>
  buildingSprites: Map<string, SpriteData>
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load a tileset by name from /assets/tilesets/{name}/tileset.json.
 * Downloads all referenced sprite sheet PNGs and extracts individual tiles.
 * Returns null if tileset.json or any PNG fails to load.
 */
export async function loadTileset(name: string): Promise<LoadedTileset | null> {
  const basePath = `/assets/tilesets/${name}`

  // Load metadata
  let config: TilesetConfig
  try {
    const res = await fetch(`${basePath}/tileset.json`)
    if (!res.ok) return null
    config = await res.json() as TilesetConfig
  } catch {
    return null
  }

  const tileSize = config.tileSize || 16

  // Load all sprite sheet images
  const sheetImages = new Map<string, HTMLImageElement>()
  for (const [sheetId, sheetDef] of Object.entries(config.sheets)) {
    const img = await loadImage(`${basePath}/${sheetDef.file}`)
    if (!img) return null
    sheetImages.set(sheetId, img)
  }

  // Extract tiles from sheets → SpriteData
  const sprites = new Map<string, SpriteData>()
  const canvas = document.createElement('canvas')
  canvas.width = tileSize
  canvas.height = tileSize
  const ctx = canvas.getContext('2d')!

  for (const [tileName, tileRef] of Object.entries(config.tiles)) {
    const img = sheetImages.get(tileRef.sheet)
    if (!img) continue

    // Clear and draw the tile region
    ctx.clearRect(0, 0, tileSize, tileSize)
    ctx.drawImage(
      img,
      tileRef.col * tileSize,
      tileRef.row * tileSize,
      tileSize,
      tileSize,
      0, 0,
      tileSize, tileSize,
    )

    // Read pixel data and convert to SpriteData (hex color strings)
    const imageData = ctx.getImageData(0, 0, tileSize, tileSize)
    const sprite = imageDataToSpriteData(imageData, tileSize)
    sprites.set(tileName, sprite)
  }

  // Load building PNGs (standalone images, not from sheet grid)
  const buildingSprites = new Map<string, SpriteData>()
  if (config.buildings) {
    for (const [buildingId, buildingDef] of Object.entries(config.buildings)) {
      const img = await loadImage(`${basePath}/${buildingDef.file}`)
      if (!img) {
        console.log(`[Tileset] Building sprite not found: ${buildingDef.file} — will use fallback`)
        continue
      }
      // Draw full image to offscreen canvas and extract as SpriteData
      const bCanvas = document.createElement('canvas')
      bCanvas.width = img.width
      bCanvas.height = img.height
      const bCtx = bCanvas.getContext('2d')!
      bCtx.drawImage(img, 0, 0)
      const bImageData = bCtx.getImageData(0, 0, img.width, img.height)
      const bSprite = imageDataToSpriteData(bImageData, img.width, img.height)
      buildingSprites.set(buildingId, bSprite)
    }
  }

  const buildingCount = buildingSprites.size > 0 ? `, ${buildingSprites.size} buildings` : ''
  console.log(`[Tileset] Loaded "${config.name}" — ${sprites.size} tiles from ${sheetImages.size} sheet(s)${buildingCount}`)

  return { config, sprites, buildingSprites }
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/**
 * Get a single named tile sprite from a loaded tileset.
 */
export function getTileSprite(tileset: LoadedTileset, tileName: string): SpriteData | null {
  return tileset.sprites.get(tileName) ?? null
}

/**
 * Get a building sprite by building ID from a loaded tileset.
 */
export function getBuildingSprite(tileset: LoadedTileset, buildingId: string): SpriteData | null {
  return tileset.buildingSprites.get(buildingId) ?? null
}

/**
 * Get all sprites mapped to a TileType name (e.g., "FLOOR_1" → ["grass_1", "grass_2"]).
 * Returns empty array if no mapping exists for that tile type.
 */
export function getMappedSprites(tileset: LoadedTileset, tileTypeName: string): SpriteData[] {
  const names = tileset.config.mapping[tileTypeName]
  if (!names) return []
  const result: SpriteData[] = []
  for (const name of names) {
    const sprite = tileset.sprites.get(name)
    if (sprite) result.push(sprite)
  }
  return result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => {
      console.log(`[Tileset] Failed to load image: ${src}`)
      resolve(null)
    }
    img.src = src
  })
}

/**
 * Convert canvas ImageData to the SpriteData format (2D array of hex color strings).
 * Transparent pixels (alpha < 128) become empty string '' (rendered as transparent).
 * Accepts width and height for arbitrary-sized images (buildings, etc.).
 */
function imageDataToSpriteData(imageData: ImageData, width: number, height?: number): SpriteData {
  const h = height ?? width
  const sprite: SpriteData = []
  for (let row = 0; row < h; row++) {
    const rowData: string[] = []
    for (let col = 0; col < width; col++) {
      const idx = (row * width + col) * 4
      const r = imageData.data[idx]!
      const g = imageData.data[idx + 1]!
      const b = imageData.data[idx + 2]!
      const a = imageData.data[idx + 3]!

      if (a < 128) {
        rowData.push('') // Transparent
      } else {
        rowData.push(rgbToHex(r, g, b))
      }
    }
    sprite.push(rowData)
  }
  return sprite
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase()
}
