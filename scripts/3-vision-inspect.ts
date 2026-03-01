/**
 * Stage 3: Vision Inspection & Auto-Metadata Generation
 *
 * Uses Claude's vision API to analyze each asset and suggest:
 * - Name, Label, Category
 * - isDesk flag, canPlaceOnWalls flag
 *
 * Usage:
 *   npx ts-node scripts/inspect-assets.ts
 *
 * Requires:
 *   - asset-editor-output.json (approved assets)
 *   - assets/office_tileset_16x16.png (source tileset)
 *   - ANTHROPIC_API_KEY environment variable
 */

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { PNG } from 'pngjs'
import Anthropic from '@anthropic-ai/sdk'

// Load .env file
function loadEnv() {
  try {
    const envPath = join(__dirname, '..', '.env')
    const envContent = readFileSync(envPath, 'utf-8')
    const lines = envContent.split('\n')
    for (const line of lines) {
      const [key, ...valueParts] = line.split('=')
      const value = valueParts.join('=').trim()
      if (key && value) {
        process.env[key.trim()] = value
      }
    }
  } catch (err) {
    // .env file not found, will rely on environment variable
  }
}

interface AssetWithMetadata {
  id: string
  paddedX: number
  paddedY: number
  paddedWidth: number
  paddedHeight: number
  erasedPixels?: Array<{ x: number; y: number }>
  // Suggestions from vision
  suggestedName?: string
  suggestedLabel?: string
  suggestedCategory?: string
  suggestedIsDesk?: boolean
  suggestedCanPlaceOnWalls?: boolean
}

const pngPath = './webview-ui/public/assets/office_tileset_16x16.png'
const inputJsonPath = './scripts/.tileset-working/asset-editor-output.json'
const outputJsonPath = './scripts/.tileset-working/tileset-metadata-draft.json'

console.log(`\n🔍 Stage 3: Vision Inspection & Auto-Metadata\n`)

console.log(`📖 Loading ${inputJsonPath}...`)
const inputData = JSON.parse(readFileSync(inputJsonPath, 'utf-8'))
const assets: AssetWithMetadata[] = inputData.assets

console.log(`📷 Loading ${pngPath}...`)
const pngBuffer = readFileSync(pngPath)
const png = PNG.sync.read(pngBuffer)
const { width: pngWidth, height: pngHeight, data: pngData } = png

console.log(`   Found ${assets.length} assets to inspect\n`)

function extractAssetPng(asset: AssetWithMetadata): Buffer {
  const w = asset.paddedWidth
  const h = asset.paddedHeight

  // Create new PNG for this asset
  const assetPng = new PNG({ width: w, height: h })

  // Copy pixels from tileset, handling out-of-bounds and erased pixels
  const erasedSet = new Set(
    (asset.erasedPixels || []).map((p) => `${p.x},${p.y}`),
  )

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sourceX = asset.paddedX + x
      const sourceY = asset.paddedY + y
      const isErased = erasedSet.has(`${x},${y}`)

      // Destination pixel index
      const dstIdx = (y * w + x) << 2

      // Check if pixel is out of bounds or erased
      if (
        sourceX < 0 ||
        sourceX >= pngWidth ||
        sourceY < 0 ||
        sourceY >= pngHeight ||
        isErased
      ) {
        // Transparent (RGBA = 0,0,0,0)
        assetPng.data[dstIdx] = 0
        assetPng.data[dstIdx + 1] = 0
        assetPng.data[dstIdx + 2] = 0
        assetPng.data[dstIdx + 3] = 0
      } else {
        // Copy from source
        const srcIdx = (sourceY * pngWidth + sourceX) << 2
        assetPng.data[dstIdx] = pngData[srcIdx]
        assetPng.data[dstIdx + 1] = pngData[srcIdx + 1]
        assetPng.data[dstIdx + 2] = pngData[srcIdx + 2]
        assetPng.data[dstIdx + 3] = pngData[srcIdx + 3]
      }
    }
  }

  return PNG.sync.write(assetPng)
}

async function analyzeAsset(
  client: Anthropic,
  asset: AssetWithMetadata,
  pngBuffer: Buffer,
  index: number,
  total: number,
): Promise<void> {
  const base64 = pngBuffer.toString('base64')

  console.log(`[${index + 1}/${total}] Analyzing ${asset.id}...`)

  const prompt = `You are an expert at identifying pixel art furniture and objects. Analyze this pixel art image and provide metadata.

Return ONLY valid JSON on a single line (no markdown, no explanation):
{
  "name": "UPPERCASE_SNAKE_CASE name (e.g., DESK_WOOD_SM, CHAIR_SPINNING, PLANT_POT)",
  "label": "Human readable label (e.g., Wood Table Small, Spinning Chair)",
  "category": "one of: desks, chairs, storage, decor, electronics, misc",
  "isDesk": true/false,
  "canPlaceOnWalls": true/false
}

Guidelines:
- name: SCREAMING_SNAKE_CASE, descriptive, include size/style (SM/LG/WOOD/etc)
- label: Title Case, human friendly
- category: Pick the most specific category
- isDesk: true only if it's a desk/table where agents sit
- canPlaceOnWalls: true if item could be placed on wall tiles (e.g., wall art, shelves, clocks)`

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: base64,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    })

    // Extract JSON from response
    const text =
      response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn(`   ⚠️  No JSON found in response, skipping`)
      return
    }

    const data = JSON.parse(jsonMatch[0])
    asset.suggestedName = data.name
    asset.suggestedLabel = data.label
    asset.suggestedCategory = data.category
    asset.suggestedIsDesk = data.isDesk
    asset.suggestedCanPlaceOnWalls = data.canPlaceOnWalls

    console.log(
      `   ✓ ${asset.suggestedName} | ${asset.suggestedLabel} | ${asset.suggestedCategory}`,
    )
  } catch (err) {
    console.warn(`   ⚠️  Error: ${err instanceof Error ? err.message : err}`)
  }
}

async function main() {
  // Load .env file first
  loadEnv()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('❌ Error: ANTHROPIC_API_KEY not set')
    console.error('   Add your key to .env file:')
    console.error('   ANTHROPIC_API_KEY=sk-ant-...')
    process.exit(1)
  }

  const client = new Anthropic({ apiKey })

  console.log(`🤖 Using Claude Opus 4.6 for vision analysis\n`)

  // Analyze each asset
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i]
    const pngBuffer = extractAssetPng(asset)
    await analyzeAsset(client, asset, pngBuffer, i, assets.length)
  }

  console.log(`\n✅ Vision analysis complete!\n`)

  // Prepare output
  const output = {
    version: 1,
    timestamp: new Date().toISOString(),
    sourceFile: inputData.sourceFile,
    tileset: inputData.tileset,
    backgroundColor: inputData.backgroundColor,
    assets: assets.map((a) => ({
      id: a.id,
      paddedX: a.paddedX,
      paddedY: a.paddedY,
      paddedWidth: a.paddedWidth,
      paddedHeight: a.paddedHeight,
      erasedPixels: a.erasedPixels,
      // Metadata suggestions (ready for user review)
      name: a.suggestedName || a.id,
      label: a.suggestedLabel || a.id,
      category: a.suggestedCategory || 'misc',
      footprintW: Math.max(1, Math.round(a.paddedWidth / 16)),
      footprintH: Math.max(1, Math.round(a.paddedHeight / 16)),
      isDesk: a.suggestedIsDesk || false,
      canPlaceOnWalls: a.suggestedCanPlaceOnWalls || false,
      discard: false,
    })),
  }

  // Write output
  writeFileSync(outputJsonPath, JSON.stringify(output, null, 2))
  console.log(`📝 Metadata suggestions saved to: ${outputJsonPath}`)

  // Summary
  const withSuggestions = assets.filter((a) => a.suggestedName).length
  console.log(`\n📊 Summary:`)
  console.log(`   Total assets: ${assets.length}`)
  console.log(`   With metadata: ${withSuggestions}`)
  console.log(`   Success rate: ${((withSuggestions / assets.length) * 100).toFixed(1)}%`)

  console.log(`\n📋 Next step: Review metadata in Stage 4`)
  console.log(`   open scripts/metadata-editor.html\n`)
}

main().catch(console.error)
