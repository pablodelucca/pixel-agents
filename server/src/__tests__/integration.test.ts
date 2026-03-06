import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as http from 'http'
import { WebSocket } from 'ws'

const PORT = 14200
const URL = `ws://localhost:${PORT}`

function connectClient(): Promise<{ ws: WebSocket; messages: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL)
    const messages: any[] = []
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()))
    })
    ws.on('open', () => resolve({ ws, messages }))
    ws.on('error', reject)
  })
}

function waitForMessage(messages: any[], type: string, count = 1, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      if (messages.filter(m => m.type === type).length >= count) {
        resolve()
      } else if (Date.now() > deadline) {
        reject(new Error(`Timeout waiting for ${count} "${type}" messages, got ${messages.filter(m => m.type === type).length}`))
      } else {
        setTimeout(check, 50)
      }
    }
    check()
  })
}

describe('Server Integration', () => {
  let server: http.Server

  beforeAll(async () => {
    const { createServer } = await import('../index.js')
    server = createServer(PORT, '/tmp/pixel-agents-test-data-' + Date.now())
    await new Promise<void>((resolve) => server.listen(PORT, resolve))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('sends welcome on connect', async () => {
    const { ws, messages } = await connectClient()
    await waitForMessage(messages, 'welcome')
    expect(messages[0].type).toBe('welcome')
    expect(messages[0].clientId).toBeDefined()
    ws.close()
  })

  it('client A heartbeat is visible to client B', async () => {
    const a = await connectClient()
    const b = await connectClient()

    a.ws.send(JSON.stringify({ type: 'join', userName: 'Alice' }))
    a.ws.send(JSON.stringify({
      type: 'heartbeat',
      agents: [{ id: 1, name: 'A1', status: 'active', appearance: { palette: 0, hueShift: 0 }, x: 10, y: 20, dir: 0, state: 0, frame: 0 }],
    }))

    await waitForMessage(b.messages, 'presence', 2)
    const presence = b.messages.filter(m => m.type === 'presence').pop()
    const aliceClient = presence.clients.find((c: any) => c.userName === 'Alice')
    expect(aliceClient).toBeDefined()
    expect(aliceClient.agents).toHaveLength(1)

    a.ws.close()
    b.ws.close()
  })

  it('layoutPut sender does not receive layoutFull echo', async () => {
    const a = await connectClient()
    const b = await connectClient()

    a.ws.send(JSON.stringify({ type: 'join', userName: 'Alice' }))
    await waitForMessage(a.messages, 'presence')

    a.ws.send(JSON.stringify({ type: 'layoutPut', layout: '{"version":1,"tiles":[]}' }))

    // B should get layoutFull
    await waitForMessage(b.messages, 'layoutFull')
    const bLayout = b.messages.find(m => m.type === 'layoutFull')
    expect(bLayout).toBeDefined()
    expect(JSON.parse(bLayout.layoutJson)).toEqual({ version: 1, tiles: [] })

    // A should NOT get layoutFull (wait a bit then check)
    await new Promise(r => setTimeout(r, 200))
    const aLayout = a.messages.find(m => m.type === 'layoutFull')
    expect(aLayout).toBeUndefined()

    a.ws.close()
    b.ws.close()
  })

  it('client disconnect triggers updated presence', async () => {
    const a = await connectClient()
    const b = await connectClient()

    a.ws.send(JSON.stringify({ type: 'join', userName: 'Alice' }))
    await waitForMessage(b.messages, 'presence')

    a.ws.close()
    // Wait for 2 more presence updates (disconnect broadcast)
    await waitForMessage(b.messages, 'presence', 3)
    const last = b.messages.filter(m => m.type === 'presence').pop()
    const aliceClient = last.clients.find((c: any) => c.userName === 'Alice')
    expect(aliceClient).toBeUndefined()

    b.ws.close()
  })
})
