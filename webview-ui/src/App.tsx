import { useRef, useCallback, useState } from 'react'
import { OfficeState } from './office/engine/officeState.js'
import { OfficeCanvas } from './office/components/OfficeCanvas.js'
import { EditorState } from './office/editor/editorState.js'
import { ZoomControls } from './components/ZoomControls.js'
import { useTownInit } from './hooks/useTownInit.js'
import { usePlayerInput } from './hooks/usePlayerInput.js'
import { defaultTownLayout } from './data/defaultTownLayout.js'

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
  usePlayerInput(getOfficeState, layoutReady)

  const [zoom, setZoom] = useState(() => Math.round(3 * (window.devicePixelRatio || 1)))
  const panRef = useRef({ x: 0, y: 0 })

  const handleZoomChange = useCallback((z: number) => setZoom(z), [])

  const handleClick = useCallback((_agentId: number) => {
    // In town mode, clicking an NPC will eventually open dialogue
    // For now, no-op
  }, [])

  // No-op editor callbacks (editor mode disabled)
  const noop = useCallback(() => {}, [])
  const noopTile = useCallback((_c: number, _r: number) => {}, [])
  const noopDrag = useCallback((_u: string, _c: number, _r: number) => {}, [])

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
      />

      <ZoomControls zoom={zoom} onZoomChange={handleZoomChange} />

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

      {/* Town HUD — title */}
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
        Crystalline City — WASD / Arrow Keys to move
      </div>
    </div>
  )
}

export default App
