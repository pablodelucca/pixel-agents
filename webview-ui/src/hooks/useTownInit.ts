import { useState, useEffect, useCallback } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import { createCharacter } from '../office/engine/characters.js'
import { defaultTownLayout, PLAYER_SPAWN_COL, PLAYER_SPAWN_ROW, TOWN_BUILDINGS } from '../data/defaultTownLayout.js'
import { TOWN_NPCS } from '../data/townNpcs.js'
import { TILE_SIZE } from '../office/types.js'

const PLAYER_ID = 0
const PLAYER_PALETTE = 0

/**
 * Initialize the town game state for standalone browser mode.
 * Spawns the player character and Construct NPCs from the registry.
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

    // Spawn Construct NPCs from registry
    const buildingMap = new Map(TOWN_BUILDINGS.map(b => [b.id, b]))
    for (let i = 0; i < TOWN_NPCS.length; i++) {
      const npc = TOWN_NPCS[i]
      const npcId = i + 1 // Player is 0, NPCs start at 1

      const ch = createCharacter(npcId, npc.palette, null, null, npc.hueShift, false)

      // Position at building door (or fallback to center of map)
      const building = npc.buildingId ? buildingMap.get(npc.buildingId) : null
      if (building) {
        ch.tileCol = building.doorCol
        ch.tileRow = building.doorRow
      } else {
        ch.tileCol = PLAYER_SPAWN_COL
        ch.tileRow = PLAYER_SPAWN_ROW + 2
      }
      ch.x = ch.tileCol * TILE_SIZE + TILE_SIZE / 2
      ch.y = ch.tileRow * TILE_SIZE + TILE_SIZE / 2

      // NPCs start inactive so they wander (not sit and type)
      ch.isActive = false

      // Link character back to construct registry for dialogue lookup
      ch.folderName = npc.constructName

      os.characters.set(npcId, ch)
    }

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
