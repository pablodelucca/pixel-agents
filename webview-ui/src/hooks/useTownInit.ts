import { useState, useEffect, useCallback } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import { createCharacter } from '../office/engine/characters.js'
import { defaultTownLayout, PLAYER_SPAWN_COL, PLAYER_SPAWN_ROW } from '../data/defaultTownLayout.js'
import { TILE_SIZE } from '../office/types.js'

const PLAYER_ID = 0
const PLAYER_PALETTE = 0

/**
 * Initialize the town game state for standalone browser mode.
 * Replaces useExtensionMessages (which was VS Code extension-specific).
 */
export function useTownInit(
  getOfficeState: () => OfficeState,
): { layoutReady: boolean } {
  const [layoutReady, setLayoutReady] = useState(false)

  const init = useCallback(() => {
    const os = getOfficeState()

    // Load the town layout
    os.rebuildFromLayout(defaultTownLayout)

    // Spawn the player character at the designated spawn point
    const player = createCharacter(PLAYER_ID, PLAYER_PALETTE, null, null, 0, true)
    player.tileCol = PLAYER_SPAWN_COL
    player.tileRow = PLAYER_SPAWN_ROW
    player.x = PLAYER_SPAWN_COL * TILE_SIZE + TILE_SIZE / 2
    player.y = PLAYER_SPAWN_ROW * TILE_SIZE + TILE_SIZE / 2
    os.characters.set(PLAYER_ID, player)

    // Camera follows the player
    os.cameraFollowId = PLAYER_ID

    setLayoutReady(true)
  }, [getOfficeState])

  useEffect(() => {
    init()
  }, [init])

  return { layoutReady }
}

export { PLAYER_ID }
