/**
 * Export default furniture sprites to PNG files and add catalog entries.
 *
 * Self-contained script — all sprite data and catalog metadata is defined
 * inline. Safe to run multiple times: skips existing PNGs and catalog entries.
 *
 * Run: npx tsx scripts/export-default-furniture.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { PNG } from 'pngjs'

// ── Types ────────────────────────────────────────────────────────

type SpriteData = string[][]

interface CatalogEntry {
  id: string
  name: string
  label: string
  category: string
  file: string
  width: number
  height: number
  footprintW: number
  footprintH: number
  isDesk: boolean
}

interface DefaultFurniture {
  id: string
  name: string
  label: string
  category: string
  footprintW: number
  footprintH: number
  isDesk: boolean
  sprite: SpriteData
}

// ── Sprite Data ──────────────────────────────────────────────────

const _ = '' // transparent

/** Square desk: 32x32 pixels (2x2 tiles) */
const DESK_SQUARE_SPRITE: SpriteData = (() => {
  const W = '#8B6914', L = '#A07828', S = '#B8922E', D = '#6B4E0A'
  const rows: string[][] = []
  rows.push(new Array(32).fill(_))
  rows.push([_, ...new Array(30).fill(W), _])
  for (let r = 0; r < 4; r++)
    rows.push([_, W, ...new Array(28).fill(r < 1 ? L : S), W, _])
  rows.push([_, D, ...new Array(28).fill(W), D, _])
  for (let r = 0; r < 6; r++)
    rows.push([_, W, ...new Array(28).fill(S), W, _])
  rows.push([_, W, ...new Array(28).fill(L), W, _])
  for (let r = 0; r < 6; r++)
    rows.push([_, W, ...new Array(28).fill(S), W, _])
  rows.push([_, D, ...new Array(28).fill(W), D, _])
  for (let r = 0; r < 4; r++)
    rows.push([_, W, ...new Array(28).fill(r > 2 ? L : S), W, _])
  rows.push([_, ...new Array(30).fill(W), _])
  for (let r = 0; r < 4; r++) {
    const row = new Array(32).fill(_) as string[]
    row[1] = D; row[2] = D; row[29] = D; row[30] = D
    rows.push(row)
  }
  rows.push(new Array(32).fill(_))
  rows.push(new Array(32).fill(_))
  return rows
})()

/** Plant in pot: 16x24 */
const PLANT_SPRITE: SpriteData = (() => {
  const G = '#3D8B37', D = '#2D6B27', T = '#6B4E0A', P = '#B85C3A', R = '#8B4422'
  return [
    [_, _, _, _, _, _, G, G, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, G, G, G, G, _, _, _, _, _, _, _],
    [_, _, _, _, G, G, D, G, G, G, _, _, _, _, _, _],
    [_, _, _, G, G, D, G, G, D, G, G, _, _, _, _, _],
    [_, _, G, G, G, G, G, G, G, G, G, G, _, _, _, _],
    [_, G, G, D, G, G, G, G, G, G, D, G, G, _, _, _],
    [_, G, G, G, G, D, G, G, D, G, G, G, G, _, _, _],
    [_, _, G, G, G, G, G, G, G, G, G, G, _, _, _, _],
    [_, _, _, G, G, G, D, G, G, G, G, _, _, _, _, _],
    [_, _, _, _, G, G, G, G, G, G, _, _, _, _, _, _],
    [_, _, _, _, _, G, G, G, G, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, T, T, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, T, T, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, T, T, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, R, R, R, R, R, _, _, _, _, _, _],
    [_, _, _, _, R, P, P, P, P, P, R, _, _, _, _, _],
    [_, _, _, _, R, P, P, P, P, P, R, _, _, _, _, _],
    [_, _, _, _, R, P, P, P, P, P, R, _, _, _, _, _],
    [_, _, _, _, R, P, P, P, P, P, R, _, _, _, _, _],
    [_, _, _, _, R, P, P, P, P, P, R, _, _, _, _, _],
    [_, _, _, _, R, P, P, P, P, P, R, _, _, _, _, _],
    [_, _, _, _, _, R, P, P, P, R, _, _, _, _, _, _],
    [_, _, _, _, _, _, R, R, R, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  ]
})()

/** Bookshelf: 16x32 (1 tile wide, 2 tiles tall) */
const BOOKSHELF_SPRITE: SpriteData = (() => {
  const W = '#8B6914', D = '#6B4E0A'
  const R = '#CC4444', B = '#4477AA', G = '#44AA66', Y = '#CCAA33', P = '#9955AA'
  return [
    [_, W, W, W, W, W, W, W, W, W, W, W, W, W, W, _],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, R, R, B, B, G, G, Y, Y, R, R, B, B, D, W],
    [W, D, R, R, B, B, G, G, Y, Y, R, R, B, B, D, W],
    [W, D, R, R, B, B, G, G, Y, Y, R, R, B, B, D, W],
    [W, D, R, R, B, B, G, G, Y, Y, R, R, B, B, D, W],
    [W, D, R, R, B, B, G, G, Y, Y, R, R, B, B, D, W],
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, P, P, Y, Y, B, B, G, G, P, P, R, R, D, W],
    [W, D, P, P, Y, Y, B, B, G, G, P, P, R, R, D, W],
    [W, D, P, P, Y, Y, B, B, G, G, P, P, R, R, D, W],
    [W, D, P, P, Y, Y, B, B, G, G, P, P, R, R, D, W],
    [W, D, P, P, Y, Y, B, B, G, G, P, P, R, R, D, W],
    [W, D, P, P, Y, Y, B, B, G, G, P, P, R, R, D, W],
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, G, G, R, R, P, P, B, B, Y, Y, G, G, D, W],
    [W, D, G, G, R, R, P, P, B, B, Y, Y, G, G, D, W],
    [W, D, G, G, R, R, P, P, B, B, Y, Y, G, G, D, W],
    [W, D, G, G, R, R, P, P, B, B, Y, Y, G, G, D, W],
    [W, D, G, G, R, R, P, P, B, B, Y, Y, G, G, D, W],
    [W, D, G, G, R, R, P, P, B, B, Y, Y, G, G, D, W],
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, D, D, D, D, D, D, D, D, D, D, D, D, D, D, W],
    [W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W],
    [_, W, W, W, W, W, W, W, W, W, W, W, W, W, W, _],
  ]
})()

/** Water cooler: 16x24 */
const COOLER_SPRITE: SpriteData = (() => {
  const W = '#CCDDEE', L = '#88BBDD', D = '#999999', B = '#666666'
  return [
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, D, D, D, D, D, D, _, _, _, _, _],
    [_, _, _, _, D, L, L, L, L, L, L, D, _, _, _, _],
    [_, _, _, _, D, L, L, L, L, L, L, D, _, _, _, _],
    [_, _, _, _, D, L, L, L, L, L, L, D, _, _, _, _],
    [_, _, _, _, D, L, L, L, L, L, L, D, _, _, _, _],
    [_, _, _, _, D, L, L, L, L, L, L, D, _, _, _, _],
    [_, _, _, _, _, D, D, D, D, D, D, _, _, _, _, _],
    [_, _, _, _, _, D, W, W, W, W, D, _, _, _, _, _],
    [_, _, _, _, _, D, W, W, W, W, D, _, _, _, _, _],
    [_, _, _, _, _, D, W, W, W, W, D, _, _, _, _, _],
    [_, _, _, _, _, D, W, W, W, W, D, _, _, _, _, _],
    [_, _, _, _, _, D, W, W, W, W, D, _, _, _, _, _],
    [_, _, _, _, D, D, W, W, W, W, D, D, _, _, _, _],
    [_, _, _, _, D, W, W, W, W, W, W, D, _, _, _, _],
    [_, _, _, _, D, W, W, W, W, W, W, D, _, _, _, _],
    [_, _, _, _, D, D, D, D, D, D, D, D, _, _, _, _],
    [_, _, _, _, _, D, B, B, B, B, D, _, _, _, _, _],
    [_, _, _, _, _, D, B, B, B, B, D, _, _, _, _, _],
    [_, _, _, _, _, D, B, B, B, B, D, _, _, _, _, _],
    [_, _, _, _, D, D, B, B, B, B, D, D, _, _, _, _],
    [_, _, _, _, D, B, B, B, B, B, B, D, _, _, _, _],
    [_, _, _, _, D, D, D, D, D, D, D, D, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  ]
})()

/** Whiteboard: 32x16 (2 tiles wide, 1 tile tall) */
const WHITEBOARD_SPRITE: SpriteData = (() => {
  const F = '#AAAAAA', W = '#EEEEFF', M = '#CC4444', B = '#4477AA'
  return [
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    [_, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, _],
    [_, F, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, F, _],
    [_, F, W, W, M, M, M, W, W, W, W, W, B, B, B, B, W, W, W, W, W, W, W, M, W, W, W, W, W, W, F, _],
    [_, F, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, B, B, W, W, M, W, W, W, W, W, W, F, _],
    [_, F, W, W, W, W, M, M, M, M, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, B, B, W, W, F, _],
    [_, F, W, W, W, W, W, W, W, W, W, W, W, B, B, B, W, W, W, W, W, W, W, W, W, W, W, W, W, W, F, _],
    [_, F, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, M, M, M, W, W, W, W, W, W, W, F, _],
    [_, F, W, M, M, W, W, W, W, W, W, W, W, W, W, W, B, B, W, W, W, W, W, W, W, W, W, W, W, W, F, _],
    [_, F, W, W, W, W, W, W, B, B, B, W, W, W, W, W, W, W, W, W, W, W, W, W, M, M, M, M, W, W, F, _],
    [_, F, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, F, _],
    [_, F, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, W, F, _],
    [_, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, F, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  ]
})()

/** Chair: 16x16 */
const CHAIR_SPRITE: SpriteData = (() => {
  const W = '#8B6914', D = '#6B4E0A', B = '#5C3D0A', S = '#A07828'
  return [
    [_, _, _, _, _, D, D, D, D, D, D, _, _, _, _, _],
    [_, _, _, _, D, B, B, B, B, B, B, D, _, _, _, _],
    [_, _, _, _, D, B, S, S, S, S, B, D, _, _, _, _],
    [_, _, _, _, D, B, S, S, S, S, B, D, _, _, _, _],
    [_, _, _, _, D, B, S, S, S, S, B, D, _, _, _, _],
    [_, _, _, _, D, B, S, S, S, S, B, D, _, _, _, _],
    [_, _, _, _, D, B, S, S, S, S, B, D, _, _, _, _],
    [_, _, _, _, D, B, S, S, S, S, B, D, _, _, _, _],
    [_, _, _, _, D, B, S, S, S, S, B, D, _, _, _, _],
    [_, _, _, _, D, B, B, B, B, B, B, D, _, _, _, _],
    [_, _, _, _, _, D, D, D, D, D, D, _, _, _, _, _],
    [_, _, _, _, _, _, D, W, W, D, _, _, _, _, _, _],
    [_, _, _, _, _, _, D, W, W, D, _, _, _, _, _, _],
    [_, _, _, _, _, D, D, D, D, D, D, _, _, _, _, _],
    [_, _, _, _, _, D, _, _, _, _, D, _, _, _, _, _],
    [_, _, _, _, _, D, _, _, _, _, D, _, _, _, _, _],
  ]
})()

/** PC monitor: 16x16 */
const PC_SPRITE: SpriteData = (() => {
  const F = '#555555', S = '#3A3A5C', B = '#6688CC', D = '#444444'
  return [
    [_, _, _, F, F, F, F, F, F, F, F, F, F, _, _, _],
    [_, _, _, F, S, S, S, S, S, S, S, S, F, _, _, _],
    [_, _, _, F, S, B, B, B, B, B, B, S, F, _, _, _],
    [_, _, _, F, S, B, B, B, B, B, B, S, F, _, _, _],
    [_, _, _, F, S, B, B, B, B, B, B, S, F, _, _, _],
    [_, _, _, F, S, B, B, B, B, B, B, S, F, _, _, _],
    [_, _, _, F, S, B, B, B, B, B, B, S, F, _, _, _],
    [_, _, _, F, S, B, B, B, B, B, B, S, F, _, _, _],
    [_, _, _, F, S, S, S, S, S, S, S, S, F, _, _, _],
    [_, _, _, F, F, F, F, F, F, F, F, F, F, _, _, _],
    [_, _, _, _, _, _, _, D, D, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, D, D, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, D, D, D, D, _, _, _, _, _, _],
    [_, _, _, _, _, D, D, D, D, D, D, _, _, _, _, _],
    [_, _, _, _, _, D, D, D, D, D, D, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  ]
})()

/** Desk lamp: 16x16 */
const LAMP_SPRITE: SpriteData = (() => {
  const Y = '#FFDD55', L = '#FFEE88', D = '#888888', B = '#555555', G = '#FFFFCC'
  return [
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, G, G, G, G, _, _, _, _, _, _],
    [_, _, _, _, _, G, Y, Y, Y, Y, G, _, _, _, _, _],
    [_, _, _, _, G, Y, Y, L, L, Y, Y, G, _, _, _, _],
    [_, _, _, _, Y, Y, L, L, L, L, Y, Y, _, _, _, _],
    [_, _, _, _, Y, Y, L, L, L, L, Y, Y, _, _, _, _],
    [_, _, _, _, _, Y, Y, Y, Y, Y, Y, _, _, _, _, _],
    [_, _, _, _, _, _, D, D, D, D, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, D, D, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, D, D, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, D, D, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, D, D, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, D, D, D, D, _, _, _, _, _, _],
    [_, _, _, _, _, B, B, B, B, B, B, _, _, _, _, _],
    [_, _, _, _, _, B, B, B, B, B, B, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],
  ]
})()

// ── Furniture definitions ────────────────────────────────────────

const DEFAULT_FURNITURE: DefaultFurniture[] = [
  { id: 'desk',       name: 'DEFAULT_DESK',       label: 'Default Desk',       category: 'desks',       footprintW: 2, footprintH: 2, isDesk: true,  sprite: DESK_SQUARE_SPRITE },
  { id: 'bookshelf',  name: 'DEFAULT_BOOKSHELF',  label: 'Default Bookshelf',  category: 'storage',     footprintW: 1, footprintH: 2, isDesk: false, sprite: BOOKSHELF_SPRITE },
  { id: 'plant',      name: 'DEFAULT_PLANT',      label: 'Default Plant',      category: 'decor',       footprintW: 1, footprintH: 1, isDesk: false, sprite: PLANT_SPRITE },
  { id: 'cooler',     name: 'DEFAULT_COOLER',      label: 'Default Cooler',     category: 'misc',        footprintW: 1, footprintH: 1, isDesk: false, sprite: COOLER_SPRITE },
  { id: 'whiteboard', name: 'DEFAULT_WHITEBOARD', label: 'Default Whiteboard', category: 'decor',       footprintW: 2, footprintH: 1, isDesk: false, sprite: WHITEBOARD_SPRITE },
  { id: 'chair',      name: 'DEFAULT_CHAIR',      label: 'Default Chair',      category: 'chairs',      footprintW: 1, footprintH: 1, isDesk: false, sprite: CHAIR_SPRITE },
  { id: 'pc',         name: 'DEFAULT_PC',         label: 'Default PC',         category: 'electronics', footprintW: 1, footprintH: 1, isDesk: false, sprite: PC_SPRITE },
  { id: 'lamp',       name: 'DEFAULT_LAMP',       label: 'Default Lamp',       category: 'decor',       footprintW: 1, footprintH: 1, isDesk: false, sprite: LAMP_SPRITE },
]

// ── Helpers ──────────────────────────────────────────────────────

const ASSETS_DIR = './webview-ui/public/assets/furniture'
const CATALOG_PATH = join(ASSETS_DIR, 'furniture-catalog.json')

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function spriteDataToPng(sprite: SpriteData): Buffer {
  const height = sprite.length
  const width = sprite[0].length
  const png = new PNG({ width, height })

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const color = sprite[y][x]
      if (!color) {
        png.data[idx] = 0
        png.data[idx + 1] = 0
        png.data[idx + 2] = 0
        png.data[idx + 3] = 0
      } else {
        const [r, g, b] = hexToRgb(color)
        png.data[idx] = r
        png.data[idx + 1] = g
        png.data[idx + 2] = b
        png.data[idx + 3] = 255
      }
    }
  }

  return PNG.sync.write(png)
}

// ── Main ─────────────────────────────────────────────────────────

console.log(`\n🪑 Export Default Furniture Sprites\n`)

// Step 1: Generate PNGs (skip existing)
let pngsCreated = 0
let pngsSkipped = 0

for (const item of DEFAULT_FURNITURE) {
  const dir = join(ASSETS_DIR, item.category)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const filePath = join(dir, `${item.name}.png`)
  if (existsSync(filePath)) {
    console.log(`  · ${item.name}.png already exists, skipping`)
    pngsSkipped++
    continue
  }

  const pngBuffer = spriteDataToPng(item.sprite)
  writeFileSync(filePath, pngBuffer)

  const w = item.sprite[0].length
  const h = item.sprite.length
  console.log(`  ✓ ${item.name}.png (${w}×${h}) → ${filePath}`)
  pngsCreated++
}

console.log(`\n  PNGs: ${pngsCreated} created, ${pngsSkipped} skipped\n`)

// Step 2: Update furniture-catalog.json (skip existing entries)
console.log(`📋 Updating ${CATALOG_PATH}\n`)

const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8'))
const existingIds = new Set(catalog.assets.map((a: CatalogEntry) => a.id))

let entriesAdded = 0
let entriesSkipped = 0

for (const item of DEFAULT_FURNITURE) {
  if (existingIds.has(item.id)) {
    console.log(`  · ${item.id} already in catalog, skipping`)
    entriesSkipped++
    continue
  }

  const w = item.sprite[0].length
  const h = item.sprite.length
  const entry: CatalogEntry = {
    id: item.id,
    name: item.name,
    label: item.label,
    category: item.category,
    file: `furniture/${item.category}/${item.name}.png`,
    width: w,
    height: h,
    footprintW: item.footprintW,
    footprintH: item.footprintH,
    isDesk: item.isDesk,
  }

  catalog.assets.push(entry)
  entriesAdded++
  console.log(`  ✓ Added ${item.id} → ${entry.file}`)
}

if (entriesAdded > 0) {
  catalog.totalAssets = catalog.assets.length
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n')
  console.log(`\n  Catalog: ${entriesAdded} added, ${entriesSkipped} skipped (${catalog.totalAssets} total)`)
} else {
  console.log(`\n  Catalog: already up to date (${entriesSkipped} skipped)`)
}

console.log(`\n✅ Done\n`)
