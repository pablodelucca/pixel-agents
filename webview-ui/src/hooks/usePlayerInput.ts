import { useEffect } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import { CharacterState, Direction } from '../office/types.js'
import { isWalkable } from '../office/layout/tileMap.js'
import { PLAYER_ID } from './useTownInit.js'

/**
 * Keyboard input handler for player character movement.
 * Arrow keys and WASD move the player one tile at a time.
 * Tile-to-tile movement (like Stardew Valley) — not pathfinding.
 */
export function usePlayerInput(
  getOfficeState: () => OfficeState,
  layoutReady: boolean,
): void {
  useEffect(() => {
    if (!layoutReady) return

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if input is focused (text fields, etc.)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      const os = getOfficeState()
      const player = os.characters.get(PLAYER_ID)
      if (!player) return

      // Only accept input when player is idle (not mid-walk)
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
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [getOfficeState, layoutReady])
}
