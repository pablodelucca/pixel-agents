import { useState, useEffect, useRef } from 'react'
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_LEVEL_FADE_DELAY_MS,
  ZOOM_LEVEL_HIDE_DELAY_MS,
  ZOOM_LEVEL_FADE_DURATION_SEC,
} from '../constants.js'

interface ZoomControlsProps {
  zoom: number
  onZoomChange: (zoom: number) => void
}

const btnBase: React.CSSProperties = {
  width: 40,
  height: 40,
  padding: 0,
  background: 'var(--pixel-bg)',
  color: 'var(--pixel-text)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: 'var(--pixel-shadow)',
}

export function ZoomControls({ zoom, onZoomChange }: ZoomControlsProps) {
  const [hovered, setHovered] = useState<'minus' | 'plus' | null>(null)
  const [showLevel, setShowLevel] = useState(false)
  const [fadeOut, setFadeOut] = useState(false)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevZoomRef = useRef(zoom)

  const minDisabled = zoom <= ZOOM_MIN
  const maxDisabled = zoom >= ZOOM_MAX

  // Show zoom level briefly when zoom changes
  useEffect(() => {
    if (zoom === prevZoomRef.current) return
    prevZoomRef.current = zoom

    // Clear existing timers
    if (showTimerRef.current) clearTimeout(showTimerRef.current)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)

    showTimerRef.current = setTimeout(() => {
      setShowLevel(true)
      setFadeOut(false)
    }, 0)

    // Start fade after delay
    fadeTimerRef.current = setTimeout(() => {
      setFadeOut(true)
    }, ZOOM_LEVEL_FADE_DELAY_MS)

    // Hide completely after delay
    timerRef.current = setTimeout(() => {
      setShowLevel(false)
      setFadeOut(false)
    }, ZOOM_LEVEL_HIDE_DELAY_MS)

    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current)
      if (timerRef.current) clearTimeout(timerRef.current)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  }, [zoom])

  return (
    <>
      {/* Zoom level indicator at top-center */}
      {showLevel && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 'var(--pixel-controls-z)',
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-border)',
            borderRadius: 0,
            padding: '4px 12px',
            boxShadow: 'var(--pixel-shadow)',
            fontSize: '26px',
            color: 'var(--pixel-text)',
            userSelect: 'none',
            opacity: fadeOut ? 0 : 1,
            transition: `opacity ${ZOOM_LEVEL_FADE_DURATION_SEC}s ease-out`,
            pointerEvents: 'none',
          }}
        >
          {zoom}x
        </div>
      )}

      {/* Vertically stacked round buttons — top-left */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 'var(--pixel-controls-z)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <button
          onClick={() => onZoomChange(zoom + 1)}
          disabled={maxDisabled}
          onMouseEnter={() => setHovered('plus')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...btnBase,
            background: hovered === 'plus' && !maxDisabled ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
            cursor: maxDisabled ? 'default' : 'pointer',
            opacity: maxDisabled ? 'var(--pixel-btn-disabled-opacity)' : 1,
          }}
          title="Zoom in (Ctrl+Scroll)"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <line x1="9" y1="3" x2="9" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          onClick={() => onZoomChange(zoom - 1)}
          disabled={minDisabled}
          onMouseEnter={() => setHovered('minus')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...btnBase,
            background: hovered === 'minus' && !minDisabled ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
            cursor: minDisabled ? 'default' : 'pointer',
            opacity: minDisabled ? 'var(--pixel-btn-disabled-opacity)' : 1,
          }}
          title="Zoom out (Ctrl+Scroll)"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </>
  )
}
