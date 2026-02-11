/**
 * Stage 5: Export Assets to Folder Structure + Catalog
 *
 * Reads final metadata and exports approved assets as PNG files
 * organized by category, plus generates furniture-catalog.json
 *
 * Usage:
 *   npx ts-node scripts/export-tileset-assets.ts
 *
 * Requires:
 *   - tileset-metadata-final.json (approved metadata)
 *   - assets/office_tileset_16x16.png (source tileset)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { PNG } from 'pngjs'

interface Asset {
  id: string
  paddedX: number
  paddedY: number
  paddedWidth: number
  paddedHeight: number
  erasedPixels?: Array<{ x: number; y: number }>
  name: string
  label: string
  category: string
  footprintW: number
  footprintH: number
  isDesk: boolean
  colorEditable: boolean
  discard?: boolean
  partOfGroup?: boolean
  groupId?: string | null
  orientation?: string
}

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
  colorEditable: boolean
  groupId?: string
  orientation?: string
}

const metadataPath = './scripts/.tileset-working/tileset-metadata-final.json'
const tilesetPath = './webview-ui/public/assets/office_tileset_16x16.png'
const assetsDir = './webview-ui/public/assets/furniture'

console.log(`\n📦 Stage 5: Export Assets to Folder Structure + Catalog\n`)

// ─────────────────────────────────────────────────────────────────────
// Load input data
// ─────────────────────────────────────────────────────────────────────

console.log(`📖 Loading ${metadataPath}...`)
const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'))
const assets: Asset[] = metadata.assets.filter((a: Asset) => !a.discard)

console.log(`📷 Loading ${tilesetPath}...`)
const pngBuffer = readFileSync(tilesetPath)
const tileset = PNG.sync.read(pngBuffer)
const { width: tilesetWidth, height: tilesetHeight, data: tilesetData } = tileset

console.log(`   Found ${assets.length} assets to export\n`)

// ─────────────────────────────────────────────────────────────────────
// Helper: Extract asset PNG with erased pixels as transparent
// ─────────────────────────────────────────────────────────────────────

function extractAssetPng(asset: Asset): Buffer {
  const w = asset.paddedWidth
  const h = asset.paddedHeight

  const assetPng = new PNG({ width: w, height: h })
  const erasedSet = new Set(
    (asset.erasedPixels || []).map((p) => `${p.x},${p.y}`),
  )

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sourceX = asset.paddedX + x
      const sourceY = asset.paddedY + y
      const isErased = erasedSet.has(`${x},${y}`)

      const dstIdx = (y * w + x) << 2

      // Out of bounds or erased = transparent
      if (
        sourceX < 0 ||
        sourceX >= tilesetWidth ||
        sourceY < 0 ||
        sourceY >= tilesetHeight ||
        isErased
      ) {
        assetPng.data[dstIdx] = 0
        assetPng.data[dstIdx + 1] = 0
        assetPng.data[dstIdx + 2] = 0
        assetPng.data[dstIdx + 3] = 0
      } else {
        // Copy from tileset
        const srcIdx = (sourceY * tilesetWidth + sourceX) << 2
        assetPng.data[dstIdx] = tilesetData[srcIdx]
        assetPng.data[dstIdx + 1] = tilesetData[srcIdx + 1]
        assetPng.data[dstIdx + 2] = tilesetData[srcIdx + 2]
        assetPng.data[dstIdx + 3] = tilesetData[srcIdx + 3]
      }
    }
  }

  return PNG.sync.write(assetPng)
}

// ─────────────────────────────────────────────────────────────────────
// Create folder structure
// ─────────────────────────────────────────────────────────────────────

console.log(`🗑️  Cleaning old assets...`)

if (existsSync(assetsDir)) {
  rmSync(assetsDir, { recursive: true })
  console.log(`   Removed ${assetsDir}`)
}

console.log(`📁 Creating folder structure...`)

mkdirSync(assetsDir, { recursive: true })

const categories = new Set(assets.map((a) => a.category))
for (const category of categories) {
  const categoryDir = join(assetsDir, category)
  if (!existsSync(categoryDir)) {
    mkdirSync(categoryDir, { recursive: true })
  }
}

console.log(`   Created ${categories.size} category folders\n`)

// ─────────────────────────────────────────────────────────────────────
// Export assets and build catalog
// ─────────────────────────────────────────────────────────────────────

console.log(`💾 Exporting assets...\n`)

const catalog: CatalogEntry[] = []
let exported = 0

for (const asset of assets) {
  const categoryDir = join(assetsDir, asset.category)
  const filename = `${asset.name}.png`
  const filepath = join(categoryDir, filename)
  const relativePath = `furniture/${asset.category}/${filename}`

  try {
    const pngBuffer = extractAssetPng(asset)
    writeFileSync(filepath, pngBuffer)

    const entry: CatalogEntry = {
      id: asset.id,
      name: asset.name,
      label: asset.label,
      category: asset.category,
      file: relativePath,
      width: asset.paddedWidth,
      height: asset.paddedHeight,
      footprintW: asset.footprintW,
      footprintH: asset.footprintH,
      isDesk: asset.isDesk,
      colorEditable: asset.colorEditable,
    }

    // Rotation group: use explicit orientation if present, otherwise derive from name suffix
    if (asset.groupId) {
      entry.groupId = asset.groupId
      if (asset.orientation) {
        entry.orientation = asset.orientation
      } else {
        const suffix = asset.name.split('_').pop()?.toLowerCase()
        if (suffix && ['front', 'back', 'left', 'right'].includes(suffix)) {
          entry.orientation = suffix
        }
      }
    }

    catalog.push(entry)

    console.log(
      `  ✓ ${asset.category}/${filename.padEnd(30)} (${asset.paddedWidth}×${asset.paddedHeight}px)`,
    )
    exported++
  } catch (err) {
    console.warn(
      `  ✗ ${asset.category}/${filename} - ${err instanceof Error ? err.message : err}`,
    )
  }
}

console.log(`\n✅ Exported ${exported} assets\n`)

// ─────────────────────────────────────────────────────────────────────
// Generate furniture-catalog.json
// ─────────────────────────────────────────────────────────────────────

const catalogPath = join(assetsDir, 'furniture-catalog.json')
const catalogOutput = {
  version: 1,
  timestamp: new Date().toISOString(),
  totalAssets: catalog.length,
  categories: Array.from(categories).sort(),
  assets: catalog.sort((a, b) => a.id.localeCompare(b.id)),
}

writeFileSync(catalogPath, JSON.stringify(catalogOutput, null, 2))
console.log(`📋 Generated furniture-catalog.json`)
console.log(`   Location: ${catalogPath}`)
console.log(`   Assets: ${catalog.length}\n`)

// ─────────────────────────────────────────────────────────────────────
// Summary by category
// ─────────────────────────────────────────────────────────────────────

console.log(`📊 Summary by Category:`)
const byCat = new Map<string, number>()
for (const cat of categories) {
  const count = catalog.filter((a) => a.category === cat).length
  byCat.set(cat, count)
  console.log(`   ${cat.padEnd(15)} ${count} assets`)
}

console.log(`\n✅ Export complete!`)
console.log(`\n📂 Folder structure:`)
console.log(`   assets/`)
console.log(`   ├── furniture/`)
for (const cat of Array.from(categories).sort()) {
  const count = byCat.get(cat)
  console.log(`   │   ├── ${cat}/ (${count} assets)`)
}
console.log(`   │   └── furniture-catalog.json`)

console.log(`\n📋 Next step: Stage 6 - Extension Integration`)
console.log(`   The extension will load assets from assets/furniture-catalog.json\n`)
