/**
 * buildingAnimations — Smoke and door animations for town buildings.
 *
 * Smoke: looping 8-frame animation above chimney buildings.
 * Door: one-shot 4-frame open animation triggered on building entry.
 *
 * Follows the same module-level state pattern as natureSprites.ts water animation.
 */

import type { SpriteData } from './types.js'
import type { LoadedTileset } from './tilesetLoader.js'
import { TILE_SIZE } from './types.js'
import { getCachedSprite } from './sprites/spriteCache.js'
import { TOWN_BUILDINGS } from '../data/defaultTownLayout.js'

// ---------------------------------------------------------------------------
// Smoke animation state (looping)
// ---------------------------------------------------------------------------

let smokeFrames: SpriteData[] = []
let smokeAnimTimer = 0
let smokeFrameIndex = 0
const SMOKE_FRAME_DURATION = 0.15 // 150ms per frame, 8 frames = 1.2s loop

/** Buildings that show chimney smoke */
const CHIMNEY_BUILDINGS = new Set(['pyrosage_hearth', 'foundry', 'town_hall'])

/** Chimney position offsets from building topLeft (in tiles) */
const CHIMNEY_OFFSETS: Record<string, { col: number; row: number }> = {
  pyrosage_hearth: { col: 1, row: -1 },
  foundry: { col: 1, row: -1 },
  town_hall: { col: 4, row: -1 },
}

// ---------------------------------------------------------------------------
// Door animation state (one-shot)
// ---------------------------------------------------------------------------

let doorFrames: SpriteData[] = []
let activeDoorBuildingId: string | null = null
let doorFrameIndex = 0
let doorAnimTimer = 0
const DOOR_FRAME_DURATION = 0.1 // 100ms per frame, 4 frames = 0.4s

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Initialize building animation sprites from a loaded tileset.
 */
export function setBuildingAnimations(tileset: LoadedTileset): void {
  smokeFrames = []
  doorFrames = []

  // Load smoke frames (smoke_1 through smoke_8)
  for (let i = 1; i <= 8; i++) {
    const sprite = tileset.animationSprites.get(`smoke_${i}`)
    if (sprite) smokeFrames.push(sprite)
  }

  // Load door frames (door_1 through door_4)
  for (let i = 1; i <= 4; i++) {
    const sprite = tileset.animationSprites.get(`door_${i}`)
    if (sprite) doorFrames.push(sprite)
  }

  const smokeCount = smokeFrames.length
  const doorCount = doorFrames.length
  if (smokeCount > 0 || doorCount > 0) {
    console.log(`[BuildingAnimations] ${smokeCount} smoke frames, ${doorCount} door frames`)
  }
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

/**
 * Advance animation timers. Call from game update loop.
 */
export function tickBuildingAnimations(dt: number): void {
  // Smoke: continuous loop
  if (smokeFrames.length > 0) {
    smokeAnimTimer += dt
    if (smokeAnimTimer >= SMOKE_FRAME_DURATION) {
      smokeAnimTimer -= SMOKE_FRAME_DURATION
      smokeFrameIndex = (smokeFrameIndex + 1) % smokeFrames.length
    }
  }

  // Door: one-shot sequence
  if (activeDoorBuildingId !== null && doorFrames.length > 0) {
    doorAnimTimer += dt
    if (doorAnimTimer >= DOOR_FRAME_DURATION) {
      doorAnimTimer -= DOOR_FRAME_DURATION
      doorFrameIndex++
      if (doorFrameIndex >= doorFrames.length) {
        // Animation complete — clear
        activeDoorBuildingId = null
        doorFrameIndex = 0
        doorAnimTimer = 0
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Door trigger
// ---------------------------------------------------------------------------

/**
 * Start the door open animation for a building. Called when player presses E.
 */
export function triggerDoorOpen(buildingId: string): void {
  if (doorFrames.length === 0) return
  activeDoorBuildingId = buildingId
  doorFrameIndex = 0
  doorAnimTimer = 0
}

/**
 * Check if a door animation is currently active.
 */
export function isDoorAnimating(): boolean {
  return activeDoorBuildingId !== null
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Render smoke wisps above chimney buildings.
 */
export function renderSmoke(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  if (smokeFrames.length === 0) return
  const frame = smokeFrames[smokeFrameIndex]
  if (!frame) return

  const s = TILE_SIZE * zoom
  const cached = getCachedSprite(frame, zoom)

  for (const building of TOWN_BUILDINGS) {
    if (!CHIMNEY_BUILDINGS.has(building.id)) continue
    const offset = CHIMNEY_OFFSETS[building.id] ?? { col: 1, row: -1 }
    const sx = offsetX + (building.topLeft.col + offset.col) * s
    const sy = offsetY + (building.topLeft.row + offset.row) * s
    ctx.drawImage(cached, sx, sy)
  }
}

/**
 * Render the active door animation frame at the building's door tile.
 */
export function renderDoorAnimation(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  if (activeDoorBuildingId === null || doorFrames.length === 0) return
  const frame = doorFrames[doorFrameIndex]
  if (!frame) return

  const building = TOWN_BUILDINGS.find(b => b.id === activeDoorBuildingId)
  if (!building) return

  const s = TILE_SIZE * zoom
  const cached = getCachedSprite(frame, zoom)
  // Door sprite renders at the door tile position
  const dx = offsetX + building.doorCol * s
  const dy = offsetY + building.doorRow * s
  ctx.drawImage(cached, dx, dy)
}
