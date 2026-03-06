import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncManager } from '../SyncManager.js'
import type { SyncManagerConfig, AgentSnapshot, PresenceClient } from '../types.js'

// Capture the transport that SyncManager creates
let mockTransportInstance: any = null

vi.mock('../SyncTransport.js', () => ({
  SyncTransport: class {
    callbacks: any
    connected = false
    disposed = false
    sent: any[] = []

    constructor(_url: string, callbacks: any) {
      this.callbacks = callbacks
      mockTransportInstance = this
    }
    connect() { this.connected = true }
    send(msg: any) { this.sent.push(msg) }
    dispose() { this.disposed = true }
    get isConnected() { return this.connected }

    // Test helpers
    simulateOpen() { this.callbacks.onOpen() }
    simulateMessage(msg: any) { this.callbacks.onMessage(msg) }
    simulateClose() { this.callbacks.onClose() }
  },
}))

function makeConfig(overrides: Partial<SyncManagerConfig> = {}): SyncManagerConfig {
  return {
    serverUrl: 'ws://localhost:4200',
    userName: 'Alice',
    mode: 'connect',
    heartbeatIntervalMs: 250,
    getLocalAgents: () => [],
    onPresence: vi.fn(),
    onRemoteLayout: vi.fn(),
    ...overrides,
  }
}

describe('SyncManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockTransportInstance = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not connect in offline mode', () => {
    const mgr = new SyncManager(makeConfig({ mode: 'offline' }))
    mgr.activate()
    expect(mockTransportInstance).toBeNull()
    mgr.dispose()
  })

  it('connects in connect mode', () => {
    const mgr = new SyncManager(makeConfig({ mode: 'connect' }))
    mgr.activate()
    expect(mockTransportInstance).not.toBeNull()
    expect(mockTransportInstance.connected).toBe(true)
    mgr.dispose()
  })

  it('sends join on open', () => {
    const mgr = new SyncManager(makeConfig())
    mgr.activate()
    mockTransportInstance.simulateOpen()
    expect(mockTransportInstance.sent[0]).toEqual({ type: 'join', userName: 'Alice' })
    mgr.dispose()
  })

  it('sends heartbeat every interval', () => {
    const agents: AgentSnapshot[] = [{
      id: 1, name: 'A', status: 'active',
      appearance: { palette: 0, hueShift: 0 },
      x: 10, y: 20, dir: 0, state: 'idle', frame: 0,
    }]
    const mgr = new SyncManager(makeConfig({
      getLocalAgents: () => agents,
    }))
    mgr.activate()
    mockTransportInstance.simulateOpen()

    // join + immediate heartbeat were sent
    mockTransportInstance.sent.shift() // remove join
    const firstHeartbeat = mockTransportInstance.sent.shift() // remove first heartbeat
    expect(firstHeartbeat.type).toBe('heartbeat')

    vi.advanceTimersByTime(250)
    expect(mockTransportInstance.sent).toHaveLength(1)
    expect(mockTransportInstance.sent[0].type).toBe('heartbeat')
    expect(mockTransportInstance.sent[0].agents).toEqual(agents)

    vi.advanceTimersByTime(250)
    expect(mockTransportInstance.sent).toHaveLength(2)
    mgr.dispose()
  })

  it('sends empty agents in guest mode', () => {
    const mgr = new SyncManager(makeConfig({
      mode: 'guest',
      getLocalAgents: () => [{ id: 1, name: 'A', status: 'active' as const, appearance: { palette: 0, hueShift: 0 }, x: 0, y: 0, dir: 0, state: 'idle', frame: 0 }],
    }))
    mgr.activate()
    mockTransportInstance.simulateOpen()
    // The immediate heartbeat sent on open
    const heartbeat = mockTransportInstance.sent.find((m: any) => m.type === 'heartbeat')
    expect(heartbeat.agents).toEqual([])
    mgr.dispose()
  })

  it('calls onPresence when presence message arrives', () => {
    const onPresence = vi.fn()
    const mgr = new SyncManager(makeConfig({ onPresence }))
    mgr.activate()
    mockTransportInstance.simulateOpen()

    const clients: PresenceClient[] = [{ clientId: 'c1', userName: 'Bob', agents: [] }]
    mockTransportInstance.simulateMessage({ type: 'presence', clients })
    expect(onPresence).toHaveBeenCalledWith(clients)
    mgr.dispose()
  })

  it('calls onRemoteLayout for layoutFull message', () => {
    const onRemoteLayout = vi.fn()
    const mgr = new SyncManager(makeConfig({ onRemoteLayout }))
    mgr.activate()
    mockTransportInstance.simulateOpen()

    mockTransportInstance.simulateMessage({
      type: 'layoutFull',
      layoutJson: '{"version":1}',
      layoutEtag: 'abc',
    })
    expect(onRemoteLayout).toHaveBeenCalledWith({ version: 1 })
    mgr.dispose()
  })

  it('stops heartbeat after dispose', () => {
    const mgr = new SyncManager(makeConfig())
    mgr.activate()
    mockTransportInstance.simulateOpen()
    const sentBeforeDispose = mockTransportInstance.sent.length
    mgr.dispose()

    vi.advanceTimersByTime(1000)
    // No new messages after dispose
    expect(mockTransportInstance.sent.length).toBe(sentBeforeDispose)
  })

  it('putLayout sends via transport', () => {
    const mgr = new SyncManager(makeConfig())
    mgr.activate()
    mockTransportInstance.simulateOpen()

    mgr.putLayout({ version: 1 })
    const layoutMsg = mockTransportInstance.sent.find((m: any) => m.type === 'layoutPut')
    expect(layoutMsg).toBeDefined()
    expect(JSON.parse(layoutMsg.layout)).toEqual({ version: 1 })
    mgr.dispose()
  })

  it('putLayout is no-op in guest mode', () => {
    const mgr = new SyncManager(makeConfig({ mode: 'guest' }))
    mgr.activate()
    mockTransportInstance.simulateOpen()

    mgr.putLayout({ version: 1 })
    const layoutMsg = mockTransportInstance.sent.find((m: any) => m.type === 'layoutPut')
    expect(layoutMsg).toBeUndefined()
    mgr.dispose()
  })
})
