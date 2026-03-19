/**
 * pixelwoodCharLoader — Load Pixelwood Valley character sprite sheets.
 *
 * Loads player Walk/Idle PNGs and 8 NPC sprite sheets, extracts frames,
 * builds LoadedCharacterData[], and calls setCharacterTemplates().
 *
 * Player sheets: 236×49 (4 frames of 59×49)
 * NPC sheets: 236×343 (4 cols × 7 rows of 59×49 frames)
 *   Row 0 = walk down, 1 = walk side, 2 = walk up
 *   Row 3 = idle down, 4 = idle side, 5 = idle up, 6 = extra
 */

import type { SpriteData } from '../types.js'
import type { LoadedCharacterData } from './spriteData.js'
import { setCharacterTemplates } from './spriteData.js'
import { loadImage, imageDataToSpriteData } from '../tilesetLoader.js'

const FRAME_W = 59
const FRAME_H = 49
const FRAMES_PER_ROW = 4
const NPC_COUNT = 8

// ── Beard Overlay ───────────────────────────────────────────────
// The Magistrate is "pretty famous" for his beard.
// Beard color and positions tuned for Pixelwood 59×49 character frames.
const BEARD_COLOR = '#5C3D1E'
const BEARD_SHADOW = '#3D280F'

/**
 * Add beard pixels to a down-facing (front view) sprite frame.
 * Modifies the SpriteData in place by painting beard-colored pixels
 * in the chin/jaw area below the face.
 */
function addBeardDown(frame: SpriteData): SpriteData {
  // Clone to avoid mutating shared references
  const f = frame.map(row => [...row])
  // Down-facing: chin area rows 28-33, centered around columns 24-35
  // Jaw line (wider)
  for (let c = 23; c <= 35; c++) { f[28][c] = BEARD_COLOR }
  for (let c = 23; c <= 35; c++) { f[29][c] = BEARD_COLOR }
  // Mid beard
  for (let c = 24; c <= 34; c++) { f[30][c] = BEARD_COLOR }
  for (let c = 25; c <= 33; c++) { f[31][c] = BEARD_SHADOW }
  // Chin point
  for (let c = 26; c <= 32; c++) { f[32][c] = BEARD_SHADOW }
  for (let c = 27; c <= 31; c++) { f[33][c] = BEARD_SHADOW }
  return f
}

/**
 * Add beard pixels to a side-facing (profile) sprite frame.
 * Side sprites face LEFT in Pixelwood assets.
 */
function addBeardSide(frame: SpriteData): SpriteData {
  const f = frame.map(row => [...row])
  // Side-facing (left profile): chin extends from cols ~20-28, rows 28-33
  for (let c = 20; c <= 28; c++) { f[28][c] = BEARD_COLOR }
  for (let c = 20; c <= 27; c++) { f[29][c] = BEARD_COLOR }
  for (let c = 21; c <= 26; c++) { f[30][c] = BEARD_SHADOW }
  for (let c = 22; c <= 25; c++) { f[31][c] = BEARD_SHADOW }
  for (let c = 22; c <= 24; c++) { f[32][c] = BEARD_SHADOW }
  return f
}

/**
 * Apply beard overlay to all player sprite frames.
 * Only modifies down and side frames (beard not visible from back).
 */
function addBeardToPlayer(data: LoadedCharacterData): LoadedCharacterData {
  return {
    down: data.down.map(addBeardDown),
    up: data.up, // No beard visible from behind
    right: data.right.map(addBeardSide), // Side sprites (face left in Pixelwood)
  }
}

/**
 * Extract a single frame from a loaded image at (col, row) in a grid.
 */
function extractFrame(
  img: HTMLImageElement,
  col: number,
  row: number,
): SpriteData {
  const canvas = document.createElement('canvas')
  canvas.width = FRAME_W
  canvas.height = FRAME_H
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(
    img,
    col * FRAME_W, row * FRAME_H, FRAME_W, FRAME_H,
    0, 0, FRAME_W, FRAME_H,
  )
  const imageData = ctx.getImageData(0, 0, FRAME_W, FRAME_H)
  return imageDataToSpriteData(imageData, FRAME_W, FRAME_H)
}

/**
 * Extract all frames from a single-row strip (236×49 = 4 frames).
 */
function extractStrip(img: HTMLImageElement): SpriteData[] {
  const frames: SpriteData[] = []
  for (let col = 0; col < FRAMES_PER_ROW; col++) {
    frames.push(extractFrame(img, col, 0))
  }
  return frames
}

/**
 * Build LoadedCharacterData from 6 player sprite strips (Walk + Idle × 3 directions).
 *
 * Each direction needs 7 frames: [0-2] walk, [3-4] typing, [5-6] reading.
 * Walk strips have 4 frames — use first 3 for walk cycle.
 * Idle strips have 4 frames — split across typing (first 2) and reading (last 2).
 */
function buildPlayerData(
  walkDown: SpriteData[],
  walkSide: SpriteData[],
  walkUp: SpriteData[],
  idleDown: SpriteData[],
  idleSide: SpriteData[],
  idleUp: SpriteData[],
): LoadedCharacterData {
  return {
    down: [walkDown[0], walkDown[1], walkDown[2], idleDown[0], idleDown[1], idleDown[2], idleDown[3]],
    up: [walkUp[0], walkUp[1], walkUp[2], idleUp[0], idleUp[1], idleUp[2], idleUp[3]],
    right: [walkSide[0], walkSide[1], walkSide[2], idleSide[0], idleSide[1], idleSide[2], idleSide[3]],
  }
}

/**
 * Build LoadedCharacterData from an NPC sprite sheet (236×343, 4×7 grid).
 */
function buildNpcData(img: HTMLImageElement): LoadedCharacterData {
  // Extract rows we need
  const walkDownFrames = [0, 1, 2].map(c => extractFrame(img, c, 0))
  const walkSideFrames = [0, 1, 2].map(c => extractFrame(img, c, 1))
  const walkUpFrames = [0, 1, 2].map(c => extractFrame(img, c, 2))
  const idleDownFrames = [0, 1, 2, 3].map(c => extractFrame(img, c, 3))
  const idleSideFrames = [0, 1, 2, 3].map(c => extractFrame(img, c, 4))
  const idleUpFrames = [0, 1, 2, 3].map(c => extractFrame(img, c, 5))

  return {
    down: [walkDownFrames[0], walkDownFrames[1], walkDownFrames[2], idleDownFrames[0], idleDownFrames[1], idleDownFrames[2], idleDownFrames[3]],
    up: [walkUpFrames[0], walkUpFrames[1], walkUpFrames[2], idleUpFrames[0], idleUpFrames[1], idleUpFrames[2], idleUpFrames[3]],
    right: [walkSideFrames[0], walkSideFrames[1], walkSideFrames[2], idleSideFrames[0], idleSideFrames[1], idleSideFrames[2], idleSideFrames[3]],
  }
}

/**
 * Load all Pixelwood Valley character sprites and register them via setCharacterTemplates.
 *
 * @param basePath Base URL path to the pixelwood tileset directory (e.g. '/assets/tilesets/pixelwood')
 * @returns true if loaded successfully, false on failure (programmatic fallback remains active)
 */
export async function loadPixelwoodCharacters(basePath: string): Promise<boolean> {
  try {
    // ── Player sprites ──────────────────────────────────────────
    const playerPath = `${basePath}/Player Character`
    const [walkDown, walkSide, walkUp, idleDown, idleSide, idleUp] = await Promise.all([
      loadImage(`${playerPath}/Walk/Down.png`),
      loadImage(`${playerPath}/Walk/Side.png`),
      loadImage(`${playerPath}/Walk/Up.png`),
      loadImage(`${playerPath}/Idle/Down.png`),
      loadImage(`${playerPath}/Idle/Side.png`),
      loadImage(`${playerPath}/Idle/Up.png`),
    ])

    if (!walkDown || !walkSide || !walkUp || !idleDown || !idleSide || !idleUp) {
      console.log('[CharLoader] Player sprite sheets not found — keeping programmatic sprites')
      return false
    }

    const playerDataRaw = buildPlayerData(
      extractStrip(walkDown),
      extractStrip(walkSide),
      extractStrip(walkUp),
      extractStrip(idleDown),
      extractStrip(idleSide),
      extractStrip(idleUp),
    )
    // The Magistrate is famous for his beard
    const playerData = addBeardToPlayer(playerDataRaw)

    // ── NPC sprites ─────────────────────────────────────────────
    const npcData: LoadedCharacterData[] = []
    const npcImages = await Promise.all(
      Array.from({ length: NPC_COUNT }, (_, i) =>
        loadImage(`${basePath}/NPCs/${i + 1}.png`),
      ),
    )

    for (let i = 0; i < NPC_COUNT; i++) {
      const img = npcImages[i]
      if (!img) {
        console.log(`[CharLoader] NPC sheet ${i + 1} not found — keeping programmatic sprites`)
        return false
      }
      npcData.push(buildNpcData(img))
    }

    // ── Register: [player, npc1, npc2, ..., npc8] ───────────────
    const allData: LoadedCharacterData[] = [playerData, ...npcData]
    setCharacterTemplates(allData)
    console.log(`[CharLoader] Loaded ${allData.length} character sprite sets (1 player + ${NPC_COUNT} NPCs)`)
    return true
  } catch (err) {
    console.log('[CharLoader] Error loading character sprites:', err)
    return false
  }
}
