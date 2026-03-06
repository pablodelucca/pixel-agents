import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncTransport } from '../SyncTransport.js'
import type { ServerMessage, SyncTransportCallbacks } from '../types.js'

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = []
  static OPEN = 1
  readyState = 0 // CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []

  url: string
  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) { this.sent.push(data) }
  close() { this.readyState = 3 }

  // Test helpers
  simulateOpen() { this.readyState = 1; this.onopen?.() }
  simulateMessage(msg: ServerMessage) { this.onmessage?.({ data: JSON.stringify(msg) }) }
  simulateClose() { this.readyState = 3; this.onclose?.() }
}

describe('SyncTransport', () => {
  let callbacks: SyncTransportCallbacks
  let transport: SyncTransport

  beforeEach(() => {
    MockWebSocket.instances = []
    ;(globalThis as any).WebSocket = MockWebSocket
    callbacks = {
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn(),
    }
  })

  afterEach(() => {
    transport?.dispose()
    delete (globalThis as any).WebSocket
  })

  it('connects to server url', () => {
    transport = new SyncTransport('ws://localhost:4200', callbacks)
    transport.connect()
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0].url).toBe('ws://localhost:4200')
  })

  it('calls onOpen when connected', () => {
    transport = new SyncTransport('ws://localhost:4200', callbacks)
    transport.connect()
    MockWebSocket.instances[0].simulateOpen()
    expect(callbacks.onOpen).toHaveBeenCalledTimes(1)
  })

  it('parses and delivers server messages', () => {
    transport = new SyncTransport('ws://localhost:4200', callbacks)
    transport.connect()
    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()

    const msg: ServerMessage = { type: 'presence', clients: [] }
    ws.simulateMessage(msg)

    expect(callbacks.onMessage).toHaveBeenCalledWith(msg)
  })

  it('sends JSON string', () => {
    transport = new SyncTransport('ws://localhost:4200', callbacks)
    transport.connect()
    const ws = MockWebSocket.instances[0]
    ws.simulateOpen()

    transport.send({ type: 'join', userName: 'Alice' })
    expect(ws.sent).toHaveLength(1)
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'join', userName: 'Alice' })
  })

  it('does not send when not connected', () => {
    transport = new SyncTransport('ws://localhost:4200', callbacks)
    transport.connect()
    // ws still CONNECTING (readyState=0), not OPEN
    transport.send({ type: 'join', userName: 'Alice' })
    expect(MockWebSocket.instances[0].sent).toHaveLength(0)
  })

  it('calls onClose and schedules reconnect', () => {
    vi.useFakeTimers()
    transport = new SyncTransport('ws://localhost:4200', callbacks)
    transport.connect()
    MockWebSocket.instances[0].simulateClose()

    expect(callbacks.onClose).toHaveBeenCalledTimes(1)

    // Advance past reconnect delay
    vi.advanceTimersByTime(2000)
    expect(MockWebSocket.instances).toHaveLength(2) // reconnected
    vi.useRealTimers()
  })

  it('does not reconnect after dispose', () => {
    vi.useFakeTimers()
    transport = new SyncTransport('ws://localhost:4200', callbacks)
    transport.connect()
    transport.dispose()
    // onclose was set to null by dispose, so simulating close does nothing
    // But even if somehow close fires, disposed flag prevents reconnect

    vi.advanceTimersByTime(10000)
    expect(MockWebSocket.instances).toHaveLength(1) // no reconnect
    vi.useRealTimers()
  })

  it('reports isConnected correctly', () => {
    transport = new SyncTransport('ws://localhost:4200', callbacks)
    expect(transport.isConnected).toBe(false)
    transport.connect()
    expect(transport.isConnected).toBe(false)
    MockWebSocket.instances[0].simulateOpen()
    expect(transport.isConnected).toBe(true)
    MockWebSocket.instances[0].simulateClose()
    expect(transport.isConnected).toBe(false)
  })
})
