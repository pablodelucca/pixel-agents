import { useEffect, useRef } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import { CharacterState, Direction } from '../office/types.js'
import { isWalkable } from '../office/layout/tileMap.js'
import { PLAYER_ID } from './useTownInit.js'

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
 * Keyboard input handler for player character movement and NPC interaction.
 * Arrow keys and WASD move the player one tile at a time.
 * E key interacts with nearby NPCs. ESC closes dialogue.
 */
export function usePlayerInput(
  getOfficeState: () => OfficeState,
  layoutReady: boolean,
  onInteract: (npcId: number | null) => void,
  onNearbyNpcChange: (npcId: number | null) => void,
): void {
  const nearbyRef = useRef<number | null>(null)

  useEffect(() => {
    if (!layoutReady) return

    // Poll for nearby NPC changes (check every 200ms)
    const interval = setInterval(() => {
      const os = getOfficeState()
      const player = os.characters.get(PLAYER_ID)
      if (!player) return

      const nearby = findNearbyNpc(os, player.tileCol, player.tileRow)
      if (nearby !== nearbyRef.current) {
        nearbyRef.current = nearby
        onNearbyNpcChange(nearby)
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

      // E key — interact with nearby NPC
      if (e.key === 'e' || e.key === 'E') {
        if (player.state === CharacterState.WALK) return
        const nearby = findNearbyNpc(os, player.tileCol, player.tileRow)
        if (nearby !== null) {
          e.preventDefault()
          onInteract(nearby)
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
  }, [getOfficeState, layoutReady, onInteract, onNearbyNpcChange])
}

export { findNearbyNpc, INTERACT_RANGE }
