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
// Beard is anchored to the FACE position in each frame (not fixed rows),
// so it tracks correctly during walk bob animation.
const BEARD_COLOR = '#5C3D1E'
const BEARD_SHADOW = '#3D280F'

/**
 * Find the chin row for beard placement.
 * Pixelwood sprites have no visible neck in pixel data — head and body
 * are a continuous block. So we use a fixed offset from the top of the
 * head (first opaque row). Chin is ~14 rows below headStart for 59×49 frames.
 */
function findChinRow(frame: SpriteData, centerCol: number, scanWidth: number): number {
  const halfW = Math.floor(scanWidth / 2)
  const startCol = centerCol - halfW
  const endCol = centerCol + halfW

  // Find first opaque row (top of head/hair)
  for (let r = 0; r < frame.length; r++) {
    let count = 0
    for (let c = startCol; c <= endCol; c++) {
      if (c >= 0 && c < frame[r].length && frame[r][c] !== '') count++
    }
    if (count >= 3) {
      // Chin = headStart + 16 rows (tuned for 59×49 Pixelwood frames)
      return r + 16
    }
  }
  return 27 // absolute fallback
}

/**
 * Add beard pixels anchored to face position in a down-facing frame.
 */
function addBeardDown(frame: SpriteData): SpriteData {
  const f = frame.map(row => [...row])
  const centerCol = Math.floor(FRAME_W / 2) // ~29
  const chin = findChinRow(f, centerCol, 12)

  // Beard hangs from chin, 4-5 rows
  const bw = 6 // half-width of beard
  for (let c = centerCol - bw; c <= centerCol + bw; c++) { if (f[chin]) f[chin][c] = BEARD_COLOR }
  for (let c = centerCol - bw; c <= centerCol + bw; c++) { if (f[chin + 1]) f[chin + 1][c] = BEARD_COLOR }
  for (let c = centerCol - bw + 1; c <= centerCol + bw - 1; c++) { if (f[chin + 2]) f[chin + 2][c] = BEARD_SHADOW }
  for (let c = centerCol - bw + 2; c <= centerCol + bw - 2; c++) { if (f[chin + 3]) f[chin + 3][c] = BEARD_SHADOW }
  for (let c = centerCol - bw + 3; c <= centerCol + bw - 3; c++) { if (f[chin + 4]) f[chin + 4][c] = BEARD_SHADOW }
  return f
}

/**
 * Add beard pixels anchored to face position in a side-facing frame.
 */
function addBeardSide(frame: SpriteData): SpriteData {
  const f = frame.map(row => [...row])
  // Side sprites face LEFT — face/chin is in the left-center area
  // (character looks left, so chin is left of sprite center)
  const faceCol = Math.floor(FRAME_W / 2) - 4
  const chin = findChinRow(f, Math.floor(FRAME_W / 2), 10)

  // Side beard: narrower, centered on the chin of the left-facing profile
  for (let c = faceCol - 2; c <= faceCol + 4; c++) { if (f[chin]) f[chin][c] = BEARD_COLOR }
  for (let c = faceCol - 1; c <= faceCol + 3; c++) { if (f[chin + 1]) f[chin + 1][c] = BEARD_COLOR }
  for (let c = faceCol; c <= faceCol + 2; c++) { if (f[chin + 2]) f[chin + 2][c] = BEARD_SHADOW }
  for (let c = faceCol; c <= faceCol + 1; c++) { if (f[chin + 3]) f[chin + 3][c] = BEARD_SHADOW }
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
