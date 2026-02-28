/**
 * useReplay — Replay controller hook.
 *
 * Fetches EAM sessions from the server, and on playback:
 * 1. Overrides NPC wander AI to pathfind constructs to their buildings
 * 2. Sets constructs to TYPE state on arrival (working animation)
 * 3. Tracks glowing buildings for the canvas overlay
 * 4. On stop, returns NPCs to idle/wander behavior
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import { CharacterState } from '../office/types.js'
import { TOWN_BUILDINGS } from '../data/defaultTownLayout.js'
import { TOWN_NPCS } from '../data/townNpcs.js'
import { findPath } from '../office/layout/tileMap.js'

const API_BASE = 'http://localhost:3001'

export interface ReplaySessionSummary {
  filename: string
  date: string | null
  epic: string | null
  constructs: string[]
  anchor: string | null
}

interface ReplayEvent {
  constructName: string
  buildingId: string | null
  type: 'work'
}

interface ReplaySessionFull extends ReplaySessionSummary {
  events: ReplayEvent[]
}

export interface ReplayState {
  session: ReplaySessionSummary
  phase: 'walking' | 'working' | 'done'
  elapsed: number
}

/** Duration in seconds NPCs spend "working" at their building before replay ends */
const WORK_DURATION_BASE_SEC = 8

export function useReplay(
  getOfficeState: () => OfficeState,
): {
  sessions: ReplaySessionSummary[]
  activeReplay: ReplayState | null
  glowingBuildings: Set<string>
  startReplay: (filename: string) => void
  stopReplay: () => void
  playbackSpeed: number
  setPlaybackSpeed: (speed: number) => void
  fetchSessions: () => void
} {
  const [sessions, setSessions] = useState<ReplaySessionSummary[]>([])
  const [activeReplay, setActiveReplay] = useState<ReplayState | null>(null)
  const [glowingBuildings, setGlowingBuildings] = useState<Set<string>>(new Set())
  const [playbackSpeed, setPlaybackSpeed] = useState(1)

  // Track replay internals via ref to avoid stale closures in the tick interval
  const replayRef = useRef<{
    events: ReplayEvent[]
    phase: 'walking' | 'working' | 'done'
    workTimer: number
    npcIds: number[] // NPC character IDs involved in this replay
    buildingIds: string[] // Buildings that should glow
    speed: number
  } | null>(null)

  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/replay/sessions`)
      if (res.ok) {
        const data: ReplaySessionSummary[] = await res.json()
        setSessions(data)
      }
    } catch {
      // Server not reachable — silent fail
    }
  }, [])

  const stopReplay = useCallback(() => {
    // Clear tick interval
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current)
      tickIntervalRef.current = null
    }

    const ref = replayRef.current
    if (ref) {
      // Return NPCs to idle wander
      const os = getOfficeState()
      for (const npcId of ref.npcIds) {
        const ch = os.characters.get(npcId)
        if (ch) {
          ch.isActive = false
          ch.state = CharacterState.IDLE
          ch.path = []
          ch.wanderTimer = 0
          ch.wanderCount = 0
        }
      }
    }

    replayRef.current = null
    setActiveReplay(null)
    setGlowingBuildings(new Set())
  }, [getOfficeState])

  const startReplay = useCallback(async (filename: string) => {
    // Stop any active replay first
    stopReplay()

    try {
      const res = await fetch(`${API_BASE}/api/replay/sessions/${encodeURIComponent(filename)}`)
      if (!res.ok) return
      const session: ReplaySessionFull = await res.json()

      if (session.events.length === 0) return

      const os = getOfficeState()
      const buildingMap = new Map(TOWN_BUILDINGS.map(b => [b.id, b]))
      const npcNameToId = new Map<string, number>()
      for (let i = 0; i < TOWN_NPCS.length; i++) {
        npcNameToId.set(TOWN_NPCS[i].constructName, i + 1)
      }

      const involvedNpcIds: number[] = []
      const involvedBuildingIds: string[] = []

      // For each event, find the NPC and pathfind them to their building
      for (const event of session.events) {
        const npcId = npcNameToId.get(event.constructName)
        if (npcId === undefined) continue

        const ch = os.characters.get(npcId)
        if (!ch) continue

        const building = event.buildingId ? buildingMap.get(event.buildingId) : null
        if (!building) continue

        // Pathfind NPC to building door
        const path = findPath(
          ch.tileCol, ch.tileRow,
          building.doorCol, building.doorRow,
          os.tileMap,
          os.blockedTiles,
        )

        if (path.length > 0) {
          ch.path = path
          ch.state = CharacterState.WALK
          ch.moveProgress = 0
          ch.frame = 0
          ch.frameTimer = 0
        } else {
          // Already at/near door — go straight to typing
          ch.state = CharacterState.TYPE
          ch.frame = 0
          ch.frameTimer = 0
        }

        // Override wander AI: mark active so they type when arriving
        ch.isActive = true
        ch.seatTimer = -1 // sentinel: skip rest countdown

        involvedNpcIds.push(npcId)
        involvedBuildingIds.push(building.id)
      }

      if (involvedNpcIds.length === 0) return

      replayRef.current = {
        events: session.events,
        phase: 'walking',
        workTimer: 0,
        npcIds: involvedNpcIds,
        buildingIds: involvedBuildingIds,
        speed: playbackSpeed,
      }

      setActiveReplay({
        session: {
          filename: session.filename,
          date: session.date,
          epic: session.epic,
          constructs: session.constructs,
          anchor: session.anchor,
        },
        phase: 'walking',
        elapsed: 0,
      })

      // Start tick loop to monitor replay progress
      const TICK_MS = 200
      tickIntervalRef.current = setInterval(() => {
        const ref = replayRef.current
        if (!ref) return

        const os2 = getOfficeState()

        if (ref.phase === 'walking') {
          // Check if all NPCs have arrived (no more path)
          const allArrived = ref.npcIds.every(id => {
            const ch = os2.characters.get(id)
            return ch && ch.path.length === 0 && ch.state === CharacterState.TYPE
          })

          if (allArrived) {
            ref.phase = 'working'
            ref.workTimer = 0
            setGlowingBuildings(new Set(ref.buildingIds))
            setActiveReplay(prev => prev ? { ...prev, phase: 'working' } : null)
          }
        } else if (ref.phase === 'working') {
          ref.workTimer += (TICK_MS / 1000) * ref.speed
          setActiveReplay(prev => prev ? { ...prev, elapsed: ref.workTimer } : null)

          if (ref.workTimer >= WORK_DURATION_BASE_SEC) {
            ref.phase = 'done'
            setActiveReplay(prev => prev ? { ...prev, phase: 'done' } : null)
            stopReplay()
          }
        }
      }, TICK_MS)
    } catch {
      // Fetch failed — silent
    }
  }, [getOfficeState, stopReplay, playbackSpeed])

  // Sync speed changes to the ref
  useEffect(() => {
    if (replayRef.current) {
      replayRef.current.speed = playbackSpeed
    }
  }, [playbackSpeed])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current)
      }
    }
  }, [])

  return {
    sessions,
    activeReplay,
    glowingBuildings,
    startReplay,
    stopReplay,
    playbackSpeed,
    setPlaybackSpeed,
    fetchSessions,
  }
}
