/**
 * Automatic Tileset Asset Detection
 *
 * Reads a tileset PNG, detects background color, and extracts individual assets
 * using flood-fill algorithm. Auto-sizes each asset to nearest 16px multiple.
 *
 * Usage:
 *   npx ts-node scripts/detect-tileset-assets.ts assets/office_tileset_16x16.png
 */

import { readFileSync, writeFileSync } from 'fs'
import { PNG } from 'pngjs'

interface Pixel {
  r: number
  g: number
  b: number
  a: number
}

interface DetectedAsset {
  id: string
  x: number
  y: number
  width: number
  height: number
  paddedX: number
  paddedY: number
  paddedWidth: number
  paddedHeight: number
}

interface DetectionOutput {
  version: 1
  timestamp: string
  sourceFile: string
  tileset: {
    width: number
    height: number
  }
  backgroundColor: string
  totalPixels: number
  backgroundPixels: number
  assets: DetectedAsset[]
}

const args = process.argv.slice(2)
const pngPath = args[0] || './webview-ui/public/assets/office_tileset_16x16.png'

console.log(`\n📷 Reading tileset: ${pngPath}`)

const pngBuffer = readFileSync(pngPath)
const png = PNG.sync.read(pngBuffer)
const { width, height, data } = png

console.log(`   Dimensions: ${width}x${height} pixels`)

function getPixel(x: number, y: number): Pixel {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return { r: 0, g: 0, b: 0, a: 0 }
  }
  const idx = (y * width + x) * 4
  return { r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3] }
}

function setPixel(x: number, y: number, p: Pixel): void {
  const idx = (y * width + x) * 4
  data[idx] = p.r
  data[idx + 1] = p.g
  data[idx + 2] = p.b
  data[idx + 3] = p.a
}

function colorToHex(p: Pixel): string {
  return `#${p.r.toString(16).padStart(2, '0')}${p.g.toString(16).padStart(2, '0')}${p.b.toString(16).padStart(2, '0')}${p.a.toString(16).padStart(2, '0')}`
}

function pixelsEqual(p1: Pixel, p2: Pixel): boolean {
  return p1.r === p2.r && p1.g === p2.g && p1.b === p2.b && p1.a === p2.a
}

console.log(`\n🎨 Detecting background color...`)

// Count color frequency
const colorMap = new Map<string, number>()
let totalPixels = 0
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const p = getPixel(x, y)
    const hex = colorToHex(p)
    colorMap.set(hex, (colorMap.get(hex) || 0) + 1)
    totalPixels++
  }
}

// Most common color is likely background
let backgroundColor: Pixel
let bgHex: string
let bgCount: number
if (colorMap.has('00000000')) {
  // If transparent exists, assume it's background
  backgroundColor = { r: 0, g: 0, b: 0, a: 0 }
  bgHex = '00000000'
  bgCount = colorMap.get(bgHex) || 0
} else {
  // Otherwise use most frequent color
  let maxCount = 0
  let maxHex = ''
  for (const [hex, count] of colorMap) {
    if (count > maxCount) {
      maxCount = count
      maxHex = hex
    }
  }
  bgHex = maxHex
  bgCount = maxCount
  const r = parseInt(bgHex.slice(1, 3), 16)
  const g = parseInt(bgHex.slice(3, 5), 16)
  const b = parseInt(bgHex.slice(5, 7), 16)
  const a = parseInt(bgHex.slice(7, 9), 16)
  backgroundColor = { r, g, b, a }
}

console.log(`   Background: ${bgHex} (${bgCount}/${totalPixels} = ${((bgCount / totalPixels) * 100).toFixed(1)}%)`)

console.log(`\n🔍 Extracting asset regions (flood-fill)...`)

const visited = new Uint8Array(width * height)

function floodFill(startX: number, startY: number): Set<number> {
  const region = new Set<number>()
  const queue: Array<[number, number]> = [[startX, startY]]

  while (queue.length > 0) {
    const [x, y] = queue.shift()!
    const idx = y * width + x

    if (x < 0 || x >= width || y < 0 || y >= height) continue
    if (visited[idx]) continue

    const p = getPixel(x, y)
    if (pixelsEqual(p, backgroundColor)) continue

    visited[idx] = 1
    region.add(idx)

    // Add neighbors (4-connected)
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }

  return region
}

const assets: DetectedAsset[] = []
let assetId = 0

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = y * width + x
    if (visited[idx]) continue

    const p = getPixel(x, y)
    if (pixelsEqual(p, backgroundColor)) continue

    // Found start of new asset region
    const region = floodFill(x, y)
    if (region.size === 0) continue

    // Find bounding box
    let minX = width,
      maxX = -1,
      minY = height,
      maxY = -1
    for (const pixelIdx of region) {
      const py = Math.floor(pixelIdx / width)
      const px = pixelIdx % width
      minX = Math.min(minX, px)
      maxX = Math.max(maxX, px)
      minY = Math.min(minY, py)
      maxY = Math.max(maxY, py)
    }

    const assetWidth = maxX - minX + 1
    const assetHeight = maxY - minY + 1

    // Calculate padding to nearest 16px multiple
    // Center horizontally, align to bottom vertically
    const paddedWidth = Math.ceil(assetWidth / 16) * 16
    const paddedHeight = Math.ceil(assetHeight / 16) * 16

    const paddedX = minX - Math.floor((paddedWidth - assetWidth) / 2)
    const paddedY = minY - (paddedHeight - assetHeight) // bottom-aligned

    assets.push({
      id: `ASSET_${assetId++}`,
      x: minX,
      y: minY,
      width: assetWidth,
      height: assetHeight,
      paddedX: Math.max(0, paddedX),
      paddedY: Math.max(0, paddedY),
      paddedWidth,
      paddedHeight,
    })
  }
}

console.log(`   Found ${assets.length} assets`)

assets.sort((a, b) => a.paddedY - b.paddedY || a.paddedX - b.paddedX)

const output: DetectionOutput = {
  version: 1,
  timestamp: new Date().toISOString(),
  sourceFile: pngPath,
  tileset: { width, height },
  backgroundColor: bgHex,
  totalPixels,
  backgroundPixels: bgCount,
  assets,
}

const outputPath = './scripts/.tileset-working/tileset-detection-output.json'
writeFileSync(outputPath, JSON.stringify(output, null, 2))

console.log(`\n✅ Detection complete!`)
console.log(`   Output: ${outputPath}`)
console.log(`   Assets: ${assets.length}`)
console.log(`   Background: ${bgHex} (${((bgCount / totalPixels) * 100).toFixed(1)}%)`)
console.log(`\n📋 Next step: Open scripts/asset-editor.html to review and edit assets\n`)
