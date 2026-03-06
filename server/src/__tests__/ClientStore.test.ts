import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClientStore } from '../ClientStore.js'

function mockWs(readyState = 1): any {
  return { readyState, send: vi.fn(), close: vi.fn() }
}

describe('ClientStore', () => {
  let store: ClientStore

  beforeEach(() => {
    store = new ClientStore()
  })

  it('adds a client and returns its id', () => {
    const ws = mockWs()
    const id = store.add(ws)
    expect(typeof id).toBe('string')
    expect(store.size).toBe(1)
  })

  it('builds presence list excluding a client', () => {
    const ws1 = mockWs()
    const ws2 = mockWs()
    const id1 = store.add(ws1)
    const id2 = store.add(ws2)
    store.setUserName(id1, 'Alice')
    store.setUserName(id2, 'Bob')

    const forBob = store.buildPresenceList(id2)
    expect(forBob).toHaveLength(1)
    expect(forBob[0].userName).toBe('Alice')

    const forAlice = store.buildPresenceList(id1)
    expect(forAlice).toHaveLength(1)
    expect(forAlice[0].userName).toBe('Bob')
  })

  it('removes a client', () => {
    const ws = mockWs()
    const id = store.add(ws)
    store.remove(id)
    expect(store.size).toBe(0)
  })

  it('updates agents on heartbeat', () => {
    const ws = mockWs()
    const id = store.add(ws)
    const agents = [{ id: 1, name: 'A1', status: 'active' as const, appearance: { palette: 0, hueShift: 0 }, x: 10, y: 20, dir: 0, state: 0, frame: 0 }]
    store.updateAgents(id, agents)

    const presence = store.buildPresenceList('other')
    expect(presence[0].agents).toEqual(agents)
  })

  it('broadcasts to all open clients', () => {
    const ws1 = mockWs()
    const ws2 = mockWs()
    const ws3 = mockWs(3) // CLOSED
    store.add(ws1)
    store.add(ws2)
    store.add(ws3)

    store.broadcastPresence()

    expect(ws1.send).toHaveBeenCalledTimes(1)
    expect(ws2.send).toHaveBeenCalledTimes(1)
    expect(ws3.send).not.toHaveBeenCalled()
  })

  it('cleans up stale clients after timeout', () => {
    const ws = mockWs()
    const id = store.add(ws)
    store.setLastHeartbeat(id, Date.now() - 20000)

    const removed = store.cleanupStale(10000)
    expect(removed).toBe(true)
    expect(store.size).toBe(0)
    expect(ws.close).toHaveBeenCalled()
  })

  it('does not clean up fresh clients', () => {
    const ws = mockWs()
    store.add(ws)

    const removed = store.cleanupStale(10000)
    expect(removed).toBe(false)
    expect(store.size).toBe(1)
  })
})
