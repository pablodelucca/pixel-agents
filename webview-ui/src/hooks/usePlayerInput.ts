import { useEffect, useRef } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import { CharacterState, Direction } from '../office/types.js'
import { isWalkable } from '../office/layout/tileMap.js'
import { PLAYER_ID } from './useTownInit.js'
import { TOWN_BUILDINGS } from '../data/defaultTownLayout.js'
import { INTERIOR_LAYOUTS } from '../data/interiorLayouts.js'

/** Max tile distance for NPC interaction */
const INTERACT_RANGE = 2

/**
 * Find the nearest NPC within range of the player.
 * Returns the NPC's character ID, or null if none nearby.
 */
function findNearbyNpc(os: OfficeState, playerCol: number, playerRow: number): number | null {
  let bestId: number | null = null
  let bestDist = Infinity

  for (const ch of os.characters.values()) {
    if (ch.isPlayer) continue
    const dist = Math.abs(ch.tileCol - playerCol) + Math.abs(ch.tileRow - playerRow)
    if (dist <= INTERACT_RANGE && dist < bestDist) {
      bestDist = dist
      bestId = ch.id
    }
  }
  return bestId
}

/**
 * Find a building whose door the player is standing adjacent to (one tile south of door).
 * Returns the building ID, or null if not near any door.
 */
function findNearbyBuilding(playerCol: number, playerRow: number, playerDir: Direction): string | null {
  for (const building of TOWN_BUILDINGS) {
    // Player must be one tile south of the door and facing up
    if (playerCol === building.doorCol && playerRow === building.doorRow + 1 && playerDir === Direction.UP) {
      return building.id
    }
  }
  return null
}

/**
 * Keyboard input handler for player character movement, NPC interaction,
 * and building entry/exit.
 */
export function usePlayerInput(
  getOfficeState: () => OfficeState,
  layoutReady: boolean,
  onInteract: (npcId: number | null) => void,
  onNearbyNpcChange: (npcId: number | null) => void,
  scene: 'town' | 'interior',
  onEnterBuilding: (buildingId: string) => void,
  onExitBuilding: () => void,
  onNearbyBuildingChange: (buildingId: string | null) => void,
  currentBuildingId: string | null,
): void {
  const nearbyRef = useRef<number | null>(null)
  const nearbyBuildingRef = useRef<string | null>(null)
  const sceneRef = useRef(scene)
  const currentBuildingIdRef = useRef(currentBuildingId)
  sceneRef.current = scene
  currentBuildingIdRef.current = currentBuildingId

  useEffect(() => {
    if (!layoutReady) return

    // Poll for nearby NPC + building changes (check every 200ms)
    const interval = setInterval(() => {
      const os = getOfficeState()
      const player = os.characters.get(PLAYER_ID)
      if (!player) return

      // NPC proximity (works in both town and interior)
      const nearby = findNearbyNpc(os, player.tileCol, player.tileRow)
      if (nearby !== nearbyRef.current) {
        nearbyRef.current = nearby
        onNearbyNpcChange(nearby)
      }

      if (sceneRef.current === 'town') {
        // Building door proximity (town only)
        const buildingId = findNearbyBuilding(player.tileCol, player.tileRow, player.dir)
        if (buildingId !== nearbyBuildingRef.current) {
          nearbyBuildingRef.current = buildingId
          onNearbyBuildingChange(buildingId)
        }
      } else {
        // Interior exit detection — player walks onto exit tile
        const bid = currentBuildingIdRef.current
        if (bid) {
          const interior = INTERIOR_LAYOUTS[bid]
          if (interior && player.tileCol === interior.exitCol && player.tileRow === interior.exitRow) {
            onExitBuilding()
          }
        }
        // Clear building proximity in interior
        if (nearbyBuildingRef.current !== null) {
          nearbyBuildingRef.current = null
          onNearbyBuildingChange(null)
        }
      }
    }, 200)

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if input is focused (text fields, etc.)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      const os = getOfficeState()
      const player = os.characters.get(PLAYER_ID)
      if (!player) return

      // ESC closes dialogue
      if (e.key === 'Escape') {
        onInteract(null)
        return
      }

      // E key — interact with nearby NPC or enter building
      if (e.key === 'e' || e.key === 'E') {
        if (player.state === CharacterState.WALK) return

        // NPC interaction takes priority
        const nearby = findNearbyNpc(os, player.tileCol, player.tileRow)
        if (nearby !== null) {
          e.preventDefault()
          onInteract(nearby)
          return
        }

        // Building entry (town only)
        if (sceneRef.current === 'town') {
          const buildingId = findNearbyBuilding(player.tileCol, player.tileRow, player.dir)
          if (buildingId) {
            e.preventDefault()
            onEnterBuilding(buildingId)
            return
          }
        }
        return
      }

      // Only accept movement when player is idle (not mid-walk)
      if (player.state === CharacterState.WALK) return

      let dc = 0
      let dr = 0
      let dir: Direction | null = null

      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          dr = -1
          dir = Direction.UP
          break
        case 'ArrowDown':
        case 's':
        case 'S':
          dr = 1
          dir = Direction.DOWN
          break
        case 'ArrowLeft':
        case 'a':
        case 'A':
          dc = -1
          dir = Direction.LEFT
          break
        case 'ArrowRight':
        case 'd':
        case 'D':
          dc = 1
          dir = Direction.RIGHT
          break
        default:
          return // Not a movement key
      }

      e.preventDefault()

      // Close dialogue on movement
      onInteract(null)

      const targetCol = player.tileCol + dc
      const targetRow = player.tileRow + dr

      // Always update facing direction even if can't move
      if (dir !== null) {
        player.dir = dir
      }

      // Check walkability
      if (!isWalkable(targetCol, targetRow, os.tileMap, os.blockedTiles)) {
        return
      }

      // Start walking to the target tile
      player.path = [{ col: targetCol, row: targetRow }]
      player.moveProgress = 0
      player.state = CharacterState.WALK
      player.frame = 0
      player.frameTimer = 0

      // Ensure camera follows
      os.cameraFollowId = PLAYER_ID
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      clearInterval(interval)
    }
  }, [getOfficeState, layoutReady, onInteract, onNearbyNpcChange, onEnterBuilding, onExitBuilding, onNearbyBuildingChange])
}

export { findNearbyNpc, INTERACT_RANGE }
