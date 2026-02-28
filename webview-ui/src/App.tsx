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
import { ReplayPanel } from './components/ReplayPanel.js'
import { defaultTownLayout } from './data/defaultTownLayout.js'
import { TOWN_NPCS } from './data/townNpcs.js'

// Game state lives outside React — updated imperatively
const officeStateRef = { current: null as OfficeState | null }
const editorState = new EditorState()

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState(defaultTownLayout)
  }
  return officeStateRef.current
}

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

  const [dialogueNpcId, setDialogueNpcId] = useState<number | null>(null)
  const [dialogueGreeting, setDialogueGreeting] = useState<GreetingResult | null>(null)
  const [nearbyNpcId, setNearbyNpcId] = useState<number | null>(null)

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

  usePlayerInput(getOfficeState, layoutReady, handleInteract, handleNearbyChange)

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
        glowingBuildings={glowingBuildings}
      />

      <ZoomControls zoom={zoom} onZoomChange={handleZoomChange} />

      <ReplayPanel
        sessions={replaySessions}
        activeReplay={activeReplay}
        playbackSpeed={playbackSpeed}
        onPlay={startReplay}
        onStop={stopReplay}
        onSpeedChange={setPlaybackSpeed}
        onRefresh={fetchSessions}
      />

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

      {/* Town HUD — title + controls hint */}
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
        Crystalline City — WASD to move, E to talk
      </div>

      {/* Proximity hint — shown when near an NPC but not in dialogue */}
      {nearbyNpc && (
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
