import { useRef, useCallback, useState } from 'react'
import { OfficeState } from './office/engine/officeState.js'
import { OfficeCanvas } from './office/components/OfficeCanvas.js'
import { EditorState } from './office/editor/editorState.js'
import { ZoomControls } from './components/ZoomControls.js'
import { DialogueBox } from './components/DialogueBox.js'
import { useTownInit } from './hooks/useTownInit.js'
import { usePlayerInput } from './hooks/usePlayerInput.js'
import { useTownMemory, type GreetingResult } from './hooks/useTownMemory.js'
import { useReplay } from './hooks/useReplay.js'
import { useLiveActivity } from './hooks/useLiveActivity.js'
import { ReplayPanel } from './components/ReplayPanel.js'
import { defaultTownLayout, TOWN_BUILDINGS } from './data/defaultTownLayout.js'
import { TOWN_NPCS } from './data/townNpcs.js'
import { INTERIOR_LAYOUTS } from './data/interiorLayouts.js'
import { createInteriorFurnitureInstance } from './office/interiorSprites.js'
import { triggerDoorOpen, isDoorAnimating } from './office/buildingAnimations.js'
import { createCharacter } from './office/engine/characters.js'
import { TILE_SIZE } from './office/types.js'
import type { Character } from './office/types.js'

// Game state lives outside React — updated imperatively
const officeStateRef = { current: null as OfficeState | null }
const editorState = new EditorState()

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState(defaultTownLayout)
  }
  return officeStateRef.current
}

const PLAYER_ID = 0

function App() {
  const { layoutReady } = useTownInit(getOfficeState)
  const { getGreeting, logInteraction } = useTownMemory()
  const {
    sessions: replaySessions,
    activeReplay,
    glowingBuildings,
    startReplay,
    stopReplay,
    playbackSpeed,
    setPlaybackSpeed,
    fetchSessions,
  } = useReplay(getOfficeState)

  const live = useLiveActivity()

  // Merge replay glow + live Town Hall glow
  const mergedGlowingBuildings = new Set(glowingBuildings)
  if (live.townHallGlowing) {
    mergedGlowingBuildings.add('town_hall')
  }

  const [dialogueNpcId, setDialogueNpcId] = useState<number | null>(null)
  const [dialogueGreeting, setDialogueGreeting] = useState<GreetingResult | null>(null)
  const [nearbyNpcId, setNearbyNpcId] = useState<number | null>(null)
  const [nearbyBuildingId, setNearbyBuildingId] = useState<string | null>(null)

  // Scene state — town or interior
  const [scene, setScene] = useState<'town' | 'interior'>('town')
  const [currentBuildingId, setCurrentBuildingId] = useState<string | null>(null)

  // Saved town state for restoration after exiting interior
  const savedTownCharacters = useRef<Map<number, Character>>(new Map())
  const savedPlayerPos = useRef<{ col: number; row: number }>({ col: 0, row: 0 })

  // Ref tracks the current greeting for use in the close callback (avoids stale closures)
  const greetingRef = useRef<GreetingResult | null>(null)

  // Track which NPC is in dialogue via ref (avoids stale closure in close handler)
  const dialogueNpcIdRef = useRef<number | null>(null)

  const handleInteract = useCallback((npcId: number | null) => {
    if (npcId !== null) {
      // Opening dialogue — fetch memory and compute greeting
      dialogueNpcIdRef.current = npcId
      setDialogueNpcId(npcId)
      getGreeting(npcId).then((result) => {
        greetingRef.current = result
        setDialogueGreeting(result)
      })
    } else {
      // Closing dialogue — log the interaction if we had one
      if (dialogueNpcIdRef.current !== null && greetingRef.current) {
        logInteraction(dialogueNpcIdRef.current, greetingRef.current.tier, greetingRef.current.text)
      }
      dialogueNpcIdRef.current = null
      greetingRef.current = null
      setDialogueNpcId(null)
      setDialogueGreeting(null)
    }
  }, [getGreeting, logInteraction])

  const handleNearbyChange = useCallback((npcId: number | null) => {
    setNearbyNpcId(npcId)
  }, [])

  const handleNearbyBuildingChange = useCallback((buildingId: string | null) => {
    setNearbyBuildingId(buildingId)
  }, [])

  // ── Enter building interior ───────────────────────────────────
  const enteringRef = useRef(false)

  const doEnterInterior = useCallback((buildingId: string) => {
    const interior = INTERIOR_LAYOUTS[buildingId]
    if (!interior) return

    const os = getOfficeState()
    const player = os.characters.get(PLAYER_ID)
    if (!player) return

    // Save player position and all characters
    savedPlayerPos.current = { col: player.tileCol, row: player.tileRow }
    savedTownCharacters.current = new Map(os.characters)

    // Switch to interior layout
    os.characters.clear()
    os.rebuildFromLayout(interior.layout)
    os.isInterior = true

    // Place player at interior spawn point
    player.tileCol = interior.spawnCol
    player.tileRow = interior.spawnRow
    player.x = interior.spawnCol * TILE_SIZE + TILE_SIZE / 2
    player.y = interior.spawnRow * TILE_SIZE + TILE_SIZE / 2
    player.path = []
    os.characters.set(PLAYER_ID, player)

    // Place the building's construct NPC inside
    const building = TOWN_BUILDINGS.find(b => b.id === buildingId)
    if (building) {
      const npcEntry = TOWN_NPCS.findIndex(n => n.constructName === building.construct)
      if (npcEntry >= 0) {
        const npc = TOWN_NPCS[npcEntry]
        const npcId = npcEntry + 1
        const ch = createCharacter(npcId, npc.palette, null, null, npc.hueShift, false)
        ch.tileCol = interior.npcCol
        ch.tileRow = interior.npcRow
        ch.x = interior.npcCol * TILE_SIZE + TILE_SIZE / 2
        ch.y = interior.npcRow * TILE_SIZE + TILE_SIZE / 2
        ch.isActive = false
        ch.folderName = npc.constructName
        os.characters.set(npcId, ch)
      }
    }

    // Build interior furniture instances from sprite defs
    const interiorFurniture = interior.furnitureDefs
      .map(fd => createInteriorFurnitureInstance(fd.spriteId, fd.col, fd.row))
      .filter((inst): inst is NonNullable<typeof inst> => inst !== null)
    os.furniture.push(...interiorFurniture)

    // Update walkable tiles (exclude furniture positions if needed)
    os.cameraFollowId = PLAYER_ID

    // Clear hints
    setNearbyNpcId(null)
    setNearbyBuildingId(null)
    setDialogueNpcId(null)

    setCurrentBuildingId(buildingId)
    setScene('interior')
    enteringRef.current = false
  }, [])

  const handleEnterBuilding = useCallback((buildingId: string) => {
    if (enteringRef.current) return
    enteringRef.current = true

    // Trigger door open animation, then swap scene after a short delay
    triggerDoorOpen(buildingId)
    setTimeout(() => doEnterInterior(buildingId), 500)
  }, [doEnterInterior])

  // ── Exit building interior ────────────────────────────────────
  const handleExitBuilding = useCallback(() => {
    const os = getOfficeState()
    const player = os.characters.get(PLAYER_ID)

    // Restore town layout
    os.characters.clear()
    os.rebuildFromLayout(defaultTownLayout)
    os.isInterior = false

    // Restore all saved characters
    for (const [id, ch] of savedTownCharacters.current) {
      os.characters.set(id, ch)
    }

    // Restore player position
    if (player) {
      const saved = savedPlayerPos.current
      player.tileCol = saved.col
      player.tileRow = saved.row
      player.x = saved.col * TILE_SIZE + TILE_SIZE / 2
      player.y = saved.row * TILE_SIZE + TILE_SIZE / 2
      player.path = []
      os.characters.set(PLAYER_ID, player)
    }

    os.cameraFollowId = PLAYER_ID

    setNearbyNpcId(null)
    setNearbyBuildingId(null)
    setDialogueNpcId(null)

    setCurrentBuildingId(null)
    setScene('town')
  }, [])

  usePlayerInput(
    getOfficeState,
    layoutReady,
    handleInteract,
    handleNearbyChange,
    scene,
    handleEnterBuilding,
    handleExitBuilding,
    handleNearbyBuildingChange,
    currentBuildingId,
  )

  const [zoom, setZoom] = useState(() => Math.round(3 * (window.devicePixelRatio || 1)))
  const panRef = useRef({ x: 0, y: 0 })

  const handleZoomChange = useCallback((z: number) => setZoom(z), [])

  const handleClick = useCallback((_agentId: number) => {
    // In town mode, clicking an NPC could also open dialogue
    // For now, no-op (E key is the primary interaction)
  }, [])

  // No-op editor callbacks (editor mode disabled)
  const noop = useCallback(() => {}, [])
  const noopTile = useCallback((_c: number, _r: number) => {}, [])
  const noopDrag = useCallback((_u: string, _c: number, _r: number) => {}, [])

  // Look up dialogue NPC data
  const dialogueNpc = dialogueNpcId !== null ? TOWN_NPCS[dialogueNpcId - 1] ?? null : null
  const nearbyNpc = nearbyNpcId !== null && dialogueNpcId === null ? TOWN_NPCS[nearbyNpcId - 1] ?? null : null

  // Look up nearby building name for proximity hint
  const nearbyBuilding = nearbyBuildingId !== null
    ? TOWN_BUILDINGS.find(b => b.id === nearbyBuildingId)
    : null

  // Current building name (for interior header)
  const currentBuilding = currentBuildingId
    ? TOWN_BUILDINGS.find(b => b.id === currentBuildingId)
    : null

  if (!layoutReady) {
    return (
      <div style={{ width: '100%', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', background: '#1E1E2E', fontFamily: 'monospace' }}>
        Loading Crystalline City...
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <OfficeCanvas
        officeState={getOfficeState()}
        onClick={handleClick}
        isEditMode={false}
        editorState={editorState}
        onEditorTileAction={noopTile}
        onEditorEraseAction={noopTile}
        onEditorSelectionChange={noop}
        onDeleteSelected={noop}
        onRotateSelected={noop}
        onDragMove={noopDrag}
        editorTick={0}
        zoom={zoom}
        onZoomChange={handleZoomChange}
        panRef={panRef}
        glowingBuildings={scene === 'town' ? mergedGlowingBuildings : undefined}
      />

      <ZoomControls zoom={zoom} onZoomChange={handleZoomChange} />

      {/* Replay panel — town only */}
      {scene === 'town' && (
        <ReplayPanel
          sessions={replaySessions}
          activeReplay={activeReplay}
          playbackSpeed={playbackSpeed}
          onPlay={startReplay}
          onStop={stopReplay}
          onSpeedChange={setPlaybackSpeed}
          onRefresh={fetchSessions}
          liveWatching={live.watching}
          liveJsonlPath={live.jsonlPath}
          liveIsActive={live.isActive}
          liveCurrentTool={live.currentTool}
          liveIsConnected={live.isConnected}
          onLiveWatch={live.startWatch}
          onLiveStop={live.stopWatch}
        />
      )}

      {/* Vignette overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.4) 100%)',
          pointerEvents: 'none',
          zIndex: 40,
        }}
      />

      {/* HUD — title + controls hint */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 12,
          color: '#aaa',
          fontSize: '14px',
          fontFamily: 'monospace',
          pointerEvents: 'none',
          zIndex: 50,
        }}
      >
        {scene === 'interior' && currentBuilding
          ? `Inside: ${currentBuilding.name} — WASD to move, E to talk`
          : 'Crystalline City — WASD to move, E to talk'
        }
        {scene === 'town' && live.isConnected && live.watching && (
          <div style={{ marginTop: 4, fontSize: '12px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: live.isActive ? '#4f4' : '#666',
              boxShadow: live.isActive ? '0 0 6px #4f4' : 'none',
            }} />
            <span style={{ color: live.isActive ? '#8f8' : '#666' }}>
              {live.isActive ? `Mark is working — ${live.currentTool}` : 'Mark idle'}
            </span>
          </div>
        )}
      </div>

      {/* Proximity hint — building entry (town only) */}
      {scene === 'town' && nearbyBuilding && !nearbyNpc && !dialogueNpc && (
        <div
          style={{
            position: 'absolute',
            bottom: 32,
            left: '50%',
            transform: 'translateX(-50%)',
            color: '#fa8',
            fontSize: '13px',
            fontFamily: 'monospace',
            pointerEvents: 'none',
            zIndex: 45,
            background: 'rgba(20, 20, 35, 0.8)',
            padding: '6px 16px',
            border: '1px solid #444',
          }}
        >
          Press E to enter {nearbyBuilding.name}
        </div>
      )}

      {/* Proximity hint — NPC talk */}
      {nearbyNpc && !dialogueNpc && (
        <div
          style={{
            position: 'absolute',
            bottom: 32,
            left: '50%',
            transform: 'translateX(-50%)',
            color: '#8af',
            fontSize: '13px',
            fontFamily: 'monospace',
            pointerEvents: 'none',
            zIndex: 45,
            background: 'rgba(20, 20, 35, 0.8)',
            padding: '6px 16px',
            border: '1px solid #444',
          }}
        >
          Press E to talk to {nearbyNpc.constructName}
        </div>
      )}

      {/* Interior exit hint */}
      {scene === 'interior' && !dialogueNpc && (
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            color: '#888',
            fontSize: '11px',
            fontFamily: 'monospace',
            pointerEvents: 'none',
            zIndex: 45,
          }}
        >
          Walk to the door to exit
        </div>
      )}

      {/* Dialogue box — shown when talking to an NPC */}
      {dialogueNpc && (
        <DialogueBox
          npc={dialogueNpc}
          greeting={dialogueGreeting?.text}
          visitCount={dialogueGreeting?.visitCount ?? 0}
        />
      )}
    </div>
  )
}

export default App
