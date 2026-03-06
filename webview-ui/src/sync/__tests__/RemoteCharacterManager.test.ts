import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RemoteCharacterManager } from '../RemoteCharacterManager.js'
import type { PresenceClient, AgentSnapshot } from '../types.js'
import type { Character } from '../../office/types.js'

// Mock createCharacter to avoid pulling in heavy dependencies (pathfinding, catalog, etc.)
vi.mock('../../office/engine/characters.js', () => ({
  createCharacter: (id: number, palette: number, _seatId: null, _seat: null, hueShift: number): Character => ({
    id,
    state: 'type' as any,
    dir: 0,
    x: 24,
    y: 24,
    tileCol: 1,
    tileRow: 1,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette,
    hueShift: hueShift ?? 0,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: 5,
    isActive: true,
    seatId: null,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    monitorFrame: 0,
    monitorFrameTimer: 0,
    tasks: [],
    interactTarget: null,
    interactEmoji: null,
    interactEmojiTimer: 0,
    bathroomTimer: 0,
    bathroomTarget: null,
    kamehamehaTimer: 0,
    kamehamehaPhase: null,
    kamehamehaTargetId: null,
    knockbackProgress: 0,
    knockbackFromX: 0,
    knockbackFromY: 0,
    knockbackToX: 0,
    knockbackToY: 0,
    knockbackRecoveryTimer: 0,
    chattingWithId: null,
    chattingTimer: 0,
    chatEmojis: [],
    chatEmojiIndex: 0,
    chatEmojiTimer: 0,
  }),
}))

vi.mock('../../office/engine/matrixEffect.js', () => ({
  matrixEffectSeeds: () => Array.from({ length: 16 }, () => Math.random()),
}))

// Minimal OfficeState mock — only needs a characters Map
function createMockOfficeState() {
  return { characters: new Map<number, Character>() }
}

function makeAgent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: 1,
    name: 'Agent 1',
    status: 'idle',
    appearance: { palette: 0, hueShift: 0 },
    x: 48,
    y: 48,
    dir: 0,
    state: 'idle',
    frame: 0,
    ...overrides,
  }
}

function makePresence(clientId: string, agents: AgentSnapshot[]): PresenceClient {
  return { clientId, userName: 'TestUser', agents }
}

describe('RemoteCharacterManager', () => {
  let os: ReturnType<typeof createMockOfficeState>
  let mgr: RemoteCharacterManager

  beforeEach(() => {
    os = createMockOfficeState()
    mgr = new RemoteCharacterManager(os as any)
  })

  it('creates a remote character on first presence', () => {
    mgr.updatePresence([makePresence('c1', [makeAgent()])])
    expect(os.characters.size).toBe(1)
    const ch = [...os.characters.values()][0]
    expect(ch.isRemote).toBe(true)
    expect(ch.x).toBe(48)
    expect(ch.y).toBe(48)
  })

  it('does not duplicate on consecutive updates', () => {
    mgr.updatePresence([makePresence('c1', [makeAgent()])])
    mgr.updatePresence([makePresence('c1', [makeAgent({ x: 64 })])])
    expect(os.characters.size).toBe(1)
  })

  it('updates interpolation target on update', () => {
    mgr.updatePresence([makePresence('c1', [makeAgent({ x: 48, y: 48 })])])
    mgr.updatePresence([makePresence('c1', [makeAgent({ x: 96, y: 48 })])])
    const ch = [...os.characters.values()][0]
    expect(ch.remoteTargetX).toBe(96)
  })

  it('starts despawn when agent removed from presence', () => {
    mgr.updatePresence([makePresence('c1', [makeAgent()])])
    mgr.updatePresence([makePresence('c1', [])]) // agent gone
    const ch = [...os.characters.values()][0]
    expect(ch.matrixEffect).toBe('despawn')
  })

  it('handles multiple clients with multiple agents', () => {
    mgr.updatePresence([
      makePresence('c1', [makeAgent({ id: 1 }), makeAgent({ id: 2, x: 96 })]),
      makePresence('c2', [makeAgent({ id: 1, x: 160 })]),
    ])
    expect(os.characters.size).toBe(3)
  })

  it('interpolates position toward target', () => {
    mgr.updatePresence([makePresence('c1', [makeAgent({ x: 48, y: 48 })])])
    const ch = [...os.characters.values()][0]
    // Character starts at agent position (48,48), now update target to 64
    mgr.updatePresence([makePresence('c1', [makeAgent({ x: 64, y: 48 })])])
    mgr.interpolate(0.1) // 100ms
    expect(ch.x).toBeGreaterThan(48)
    expect(ch.x).toBeLessThanOrEqual(64)
  })

  it('teleports if distance > 2 tiles', () => {
    mgr.updatePresence([makePresence('c1', [makeAgent({ x: 48, y: 48 })])])
    mgr.updatePresence([makePresence('c1', [makeAgent({ x: 500, y: 500 })])])
    const ch = [...os.characters.values()][0]
    mgr.interpolate(0.01)
    expect(ch.x).toBe(500)
    expect(ch.y).toBe(500)
  })

  it('sets bubble type for permission status', () => {
    mgr.updatePresence([makePresence('c1', [makeAgent({ status: 'permission' })])])
    // First update creates; need a second update to apply status via applyUpdate
    mgr.updatePresence([makePresence('c1', [makeAgent({ status: 'permission' })])])
    const ch = [...os.characters.values()][0]
    expect(ch.bubbleType).toBe('permission')
  })

  it('sets bubble type for waiting status', () => {
    mgr.updatePresence([makePresence('c1', [makeAgent({ status: 'idle' })])])
    mgr.updatePresence([makePresence('c1', [makeAgent({ status: 'waiting' })])])
    const ch = [...os.characters.values()][0]
    expect(ch.bubbleType).toBe('waiting')
    expect(ch.bubbleTimer).toBe(2)
  })

  it('clears bubble when status returns to idle', () => {
    mgr.updatePresence([makePresence('c1', [makeAgent({ status: 'permission' })])])
    mgr.updatePresence([makePresence('c1', [makeAgent({ status: 'permission' })])])
    mgr.updatePresence([makePresence('c1', [makeAgent({ status: 'idle' })])])
    const ch = [...os.characters.values()][0]
    expect(ch.bubbleType).toBeNull()
  })

  it('cleans up all characters on dispose', () => {
    mgr.updatePresence([makePresence('c1', [makeAgent()])])
    mgr.dispose()
    for (const ch of os.characters.values()) {
      if (ch.isRemote) expect(ch.matrixEffect).toBe('despawn')
    }
  })

  it('does not recreate character during despawn animation', () => {
    mgr.updatePresence([makePresence('c1', [makeAgent()])])
    const charId = [...os.characters.keys()][0]
    // Remove the agent to trigger despawn
    mgr.updatePresence([makePresence('c1', [])])
    expect(os.characters.get(charId)!.matrixEffect).toBe('despawn')
    // Re-add the same agent — should create a new character, not conflict with despawning one
    mgr.updatePresence([makePresence('c1', [makeAgent()])])
    expect(os.characters.size).toBe(2) // despawning + new
  })

  it('completeDespawn removes from despawning set', () => {
    mgr.updatePresence([makePresence('c1', [makeAgent()])])
    const charId = [...os.characters.keys()][0]
    mgr.updatePresence([makePresence('c1', [])])
    mgr.completeDespawn(charId)
    // After completeDespawn, the character is no longer tracked as despawning
    // This is mainly to verify no errors occur
    expect(os.characters.get(charId)!.matrixEffect).toBe('despawn')
  })

  it('snaps position when distance <= 1', () => {
    mgr.updatePresence([makePresence('c1', [makeAgent({ x: 48, y: 48 })])])
    const ch = [...os.characters.values()][0]
    // Set target very close (within 1px)
    mgr.updatePresence([makePresence('c1', [makeAgent({ x: 48.5, y: 48 })])])
    mgr.interpolate(0.01)
    expect(ch.x).toBe(48.5)
  })
})
