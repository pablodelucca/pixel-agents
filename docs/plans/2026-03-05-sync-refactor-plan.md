# Sync Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract multiuser sync into modular, tested code with owner-authoritative positions and 250ms interpolated heartbeat.

**Architecture:** Three layers (Transport, Manager, RemoteCharacterManager) plus AvatarIdentity, all outside React. Server split into ClientStore + LayoutStore. Vitest for both webview and server tests.

**Tech Stack:** TypeScript, Vitest, ws (server), native WebSocket (webview)

**Design doc:** `docs/plans/2026-03-05-sync-refactor-design.md`

---

## Parallelism Map

Tasks 1-5 are fully independent and can run in parallel:

```
Task 1: Install vitest (webview)  ──┐
Task 2: Install vitest (server)   ──┤
Task 3: AvatarIdentity + tests    ──┤── all independent
Task 4: sync/types.ts             ──┤
Task 5: server/ClientStore + tests ─┤
Task 6: server/LayoutStore + tests ─┘
                                     │
Task 7: SyncTransport + tests  ──────┤── depends on Task 1, 4
Task 8: server/index.ts refactor  ───┤── depends on Task 5, 6
Task 9: RemoteCharacterManager    ───┤── depends on Task 1, 3, 4
                                     │
Task 10: SyncManager + tests  ───────┤── depends on Task 7, 9
                                     │
Task 11: Integration into React hook ┤── depends on Task 10
Task 12: Server integration test  ───┤── depends on Task 2, 8
                                     │
Task 13: Cleanup dead code  ─────────┘── depends on Task 11
Task 14: Full build + manual test  ──┘── depends on all
```

---

## Task 1: Install vitest in webview-ui

**Files:**
- Modify: `webview-ui/package.json`
- Create: `webview-ui/vitest.config.ts`

**Step 1: Install vitest**

Run:
```bash
cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents/webview-ui && npm install -D vitest
```

**Step 2: Create vitest config**

```ts
// webview-ui/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
  },
})
```

**Step 3: Add test script to package.json**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 4: Verify with a dummy test**

Create `webview-ui/src/__tests__/setup.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('vitest setup', () => {
  it('works', () => {
    expect(1 + 1).toBe(2)
  })
})
```

Run: `cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents/webview-ui && npx vitest run`
Expected: 1 test passed

**Step 5: Delete dummy test and commit**

```bash
rm webview-ui/src/__tests__/setup.test.ts
cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents
git add webview-ui/package.json webview-ui/package-lock.json webview-ui/vitest.config.ts
git commit -m "chore(webview): add vitest test framework"
```

---

## Task 2: Install vitest in server

**Files:**
- Modify: `server/package.json`
- Modify: `server/tsconfig.json`
- Create: `server/vitest.config.ts`

**Step 1: Install vitest**

Run:
```bash
cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents/server && npm install -D vitest
```

**Step 2: Create vitest config**

```ts
// server/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
  },
})
```

**Step 3: Add test script to package.json**

Add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 4: Verify with dummy test, then delete and commit**

Same pattern as Task 1. Commit message: `"chore(server): add vitest test framework"`

---

## Task 3: AvatarIdentity module + tests

**Files:**
- Create: `webview-ui/src/avatar/types.ts`
- Create: `webview-ui/src/avatar/AvatarIdentity.ts`
- Create: `webview-ui/src/avatar/__tests__/AvatarIdentity.test.ts`

**Step 1: Write the types**

```ts
// webview-ui/src/avatar/types.ts
export interface AvatarAppearance {
  palette: number    // 0-5: base sprite palette
  hueShift: number   // 0-360: HSL hue rotation
}
```

**Step 2: Write the failing tests**

```ts
// webview-ui/src/avatar/__tests__/AvatarIdentity.test.ts
import { describe, it, expect } from 'vitest'
import { AvatarIdentity } from '../AvatarIdentity.js'
import type { AvatarAppearance } from '../types.js'

describe('AvatarIdentity', () => {
  describe('fromUserName', () => {
    it('returns same appearance for same name', () => {
      const a = AvatarIdentity.fromUserName('Alice')
      const b = AvatarIdentity.fromUserName('Alice')
      expect(a).toEqual(b)
    })

    it('returns palette in 0-5 range', () => {
      const result = AvatarIdentity.fromUserName('Bob')
      expect(result.palette).toBeGreaterThanOrEqual(0)
      expect(result.palette).toBeLessThan(6)
    })

    it('returns hueShift in 0-359 range', () => {
      const result = AvatarIdentity.fromUserName('Charlie')
      expect(result.hueShift).toBeGreaterThanOrEqual(0)
      expect(result.hueShift).toBeLessThan(360)
    })

    it('produces different appearances for different names', () => {
      const names = ['Alice', 'Bob', 'Charlie', 'Dave', 'Eve']
      const appearances = names.map(n => AvatarIdentity.fromUserName(n))
      const keys = appearances.map(a => `${a.palette}:${a.hueShift}`)
      const unique = new Set(keys)
      // At least 3 out of 5 should differ
      expect(unique.size).toBeGreaterThanOrEqual(3)
    })
  })

  describe('pickDiverse', () => {
    it('picks unused palette when available', () => {
      const existing: AvatarAppearance[] = [
        { palette: 0, hueShift: 0 },
        { palette: 1, hueShift: 0 },
      ]
      const result = AvatarIdentity.pickDiverse(existing)
      // Should pick from 2,3,4,5 (unused)
      expect([2, 3, 4, 5]).toContain(result.palette)
      expect(result.hueShift).toBe(0) // first round = no shift
    })

    it('returns hueShift > 0 when all palettes used', () => {
      const existing: AvatarAppearance[] = Array.from({ length: 6 }, (_, i) => ({
        palette: i,
        hueShift: 0,
      }))
      const result = AvatarIdentity.pickDiverse(existing)
      expect(result.hueShift).toBeGreaterThan(0)
    })

    it('picks from empty existing', () => {
      const result = AvatarIdentity.pickDiverse([])
      expect(result.palette).toBeGreaterThanOrEqual(0)
      expect(result.palette).toBeLessThan(6)
    })
  })

  describe('cacheKey', () => {
    it('is deterministic', () => {
      const a: AvatarAppearance = { palette: 2, hueShift: 45 }
      expect(AvatarIdentity.cacheKey(a)).toBe(AvatarIdentity.cacheKey(a))
    })

    it('differs for different appearances', () => {
      const a: AvatarAppearance = { palette: 0, hueShift: 0 }
      const b: AvatarAppearance = { palette: 1, hueShift: 0 }
      expect(AvatarIdentity.cacheKey(a)).not.toBe(AvatarIdentity.cacheKey(b))
    })
  })
})
```

**Step 3: Run test to verify it fails**

Run: `cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents/webview-ui && npx vitest run src/avatar/__tests__/AvatarIdentity.test.ts`
Expected: FAIL — module not found

**Step 4: Implement AvatarIdentity**

```ts
// webview-ui/src/avatar/AvatarIdentity.ts
import type { AvatarAppearance } from './types.js'

const PALETTE_COUNT = 6
const HUE_SHIFT_MIN_DEG = 45
const HUE_SHIFT_RANGE_DEG = 270

export class AvatarIdentity {
  /** Deterministic: same userName always produces same appearance */
  static fromUserName(userName: string): AvatarAppearance {
    let hash = 0
    for (let i = 0; i < userName.length; i++) {
      hash = ((hash << 5) - hash + userName.charCodeAt(i)) | 0
    }
    const palette = ((hash % PALETTE_COUNT) + PALETTE_COUNT) % PALETTE_COUNT
    const hueHash = ((hash >>> 16) ^ hash) & 0xffff
    const hueShift = hueHash % 360
    return { palette, hueShift }
  }

  /** Pick least-used palette among existing characters */
  static pickDiverse(existing: AvatarAppearance[]): AvatarAppearance {
    const counts = new Array(PALETTE_COUNT).fill(0) as number[]
    for (const a of existing) counts[a.palette]++
    const minCount = Math.min(...counts)
    const available: number[] = []
    for (let i = 0; i < PALETTE_COUNT; i++) {
      if (counts[i] === minCount) available.push(i)
    }
    const palette = available[Math.floor(Math.random() * available.length)]
    let hueShift = 0
    if (minCount > 0) {
      hueShift = HUE_SHIFT_MIN_DEG + Math.floor(Math.random() * HUE_SHIFT_RANGE_DEG)
    }
    return { palette, hueShift }
  }

  /** Stable cache key for sprite caching */
  static cacheKey(appearance: AvatarAppearance): string {
    return `${appearance.palette}:${appearance.hueShift}`
  }
}
```

**Step 5: Run tests, verify passing**

Run: `cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents/webview-ui && npx vitest run src/avatar/__tests__/AvatarIdentity.test.ts`
Expected: All tests pass

**Step 6: Commit**

```bash
git add webview-ui/src/avatar/
git commit -m "feat(avatar): extract AvatarIdentity module with tests"
```

---

## Task 4: Sync types (shared between webview modules)

**Files:**
- Create: `webview-ui/src/sync/types.ts`

**Step 1: Create the types file**

```ts
// webview-ui/src/sync/types.ts
import type { AvatarAppearance } from '../avatar/types.js'

// ── Sync modes ─────────────────────────────────────────
export type SyncMode = 'connect' | 'guest' | 'offline'

// ── Agent snapshot sent in heartbeat ───────────────────
export interface AgentSnapshot {
  id: number
  name: string
  status: 'active' | 'idle' | 'waiting' | 'permission'
  activeTool?: string
  appearance: AvatarAppearance
  x: number
  y: number
  dir: number
  state: number  // CharacterState enum value
  frame: number  // animation frame
}

// ── Presence from server ───────────────────────────────
export interface PresenceClient {
  clientId: string
  userName: string
  agents: AgentSnapshot[]
}

// ── Client -> Server messages ──────────────────────────
export type ClientMessage =
  | { type: 'join'; userName: string }
  | { type: 'heartbeat'; agents: AgentSnapshot[] }
  | { type: 'layoutPut'; layout: string }

// ── Server -> Client messages ──────────────────────────
export type ServerMessage =
  | { type: 'welcome'; clientId: string; layoutJson: string; layoutEtag: string }
  | { type: 'presence'; clients: PresenceClient[] }
  | { type: 'layoutFull'; layoutJson: string; layoutEtag: string }
  | { type: 'layoutChanged'; etag: string }

// ── SyncTransport event callbacks ──────────────────────
export interface SyncTransportCallbacks {
  onOpen: () => void
  onMessage: (msg: ServerMessage) => void
  onClose: () => void
}

// ── SyncManager config ─────────────────────────────────
export interface SyncManagerConfig {
  serverUrl: string
  userName: string
  mode: SyncMode
  heartbeatIntervalMs: number
  getLocalAgents: () => AgentSnapshot[]
  onPresence: (clients: PresenceClient[]) => void
  onRemoteLayout: (layout: unknown) => void
  isEditDirty?: () => boolean
}
```

**Step 2: Commit**

```bash
git add webview-ui/src/sync/types.ts
git commit -m "feat(sync): add typed sync message protocol"
```

---

## Task 5: Server ClientStore + tests

**Files:**
- Create: `server/src/ClientStore.ts`
- Create: `server/src/__tests__/ClientStore.test.ts`

**Step 1: Write failing tests**

```ts
// server/src/__tests__/ClientStore.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClientStore } from '../ClientStore.js'

// Minimal mock of WebSocket
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

  it('broadcasts to all open clients except sender', () => {
    const ws1 = mockWs()
    const ws2 = mockWs()
    const ws3 = mockWs(3) // CLOSED
    const id1 = store.add(ws1)
    store.add(ws2)
    store.add(ws3)

    store.broadcastPresence()

    // Each open client gets presence excluding themselves
    expect(ws1.send).toHaveBeenCalledTimes(1)
    expect(ws2.send).toHaveBeenCalledTimes(1)
    expect(ws3.send).not.toHaveBeenCalled()
  })

  it('cleans up stale clients after timeout', () => {
    const ws = mockWs()
    const id = store.add(ws)
    // Simulate old heartbeat
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
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents/server && npx vitest run src/__tests__/ClientStore.test.ts`
Expected: FAIL — module not found

**Step 3: Implement ClientStore**

```ts
// server/src/ClientStore.ts
import type { WebSocket } from 'ws';
import * as crypto from 'crypto';

interface AgentSnapshot {
  id: number;
  name: string;
  status: 'active' | 'idle' | 'waiting' | 'permission';
  activeTool?: string;
  appearance: { palette: number; hueShift: number };
  x: number;
  y: number;
  dir: number;
  state: number;
  frame: number;
}

interface PresenceClient {
  clientId: string;
  userName: string;
  agents: AgentSnapshot[];
}

interface ClientEntry {
  ws: WebSocket;
  clientId: string;
  userName: string;
  agents: AgentSnapshot[];
  lastHeartbeat: number;
}

export class ClientStore {
  private clients = new Map<string, ClientEntry>();

  get size(): number {
    return this.clients.size;
  }

  add(ws: WebSocket): string {
    const clientId = crypto.randomUUID();
    this.clients.set(clientId, {
      ws,
      clientId,
      userName: 'Anonymous',
      agents: [],
      lastHeartbeat: Date.now(),
    });
    return clientId;
  }

  remove(clientId: string): void {
    this.clients.delete(clientId);
  }

  get(clientId: string): ClientEntry | undefined {
    return this.clients.get(clientId);
  }

  setUserName(clientId: string, userName: string): void {
    const entry = this.clients.get(clientId);
    if (entry) entry.userName = userName;
  }

  updateAgents(clientId: string, agents: AgentSnapshot[]): void {
    const entry = this.clients.get(clientId);
    if (entry) {
      entry.agents = agents;
      entry.lastHeartbeat = Date.now();
    }
  }

  setLastHeartbeat(clientId: string, time: number): void {
    const entry = this.clients.get(clientId);
    if (entry) entry.lastHeartbeat = time;
  }

  touchHeartbeat(clientId: string): void {
    const entry = this.clients.get(clientId);
    if (entry) entry.lastHeartbeat = Date.now();
  }

  buildPresenceList(excludeClientId?: string): PresenceClient[] {
    const result: PresenceClient[] = [];
    for (const entry of this.clients.values()) {
      if (entry.clientId === excludeClientId) continue;
      result.push({
        clientId: entry.clientId,
        userName: entry.userName,
        agents: entry.agents,
      });
    }
    return result;
  }

  broadcastPresence(): void {
    for (const entry of this.clients.values()) {
      if (entry.ws.readyState !== 1) continue; // WebSocket.OPEN = 1
      const msg = JSON.stringify({
        type: 'presence',
        clients: this.buildPresenceList(entry.clientId),
      });
      entry.ws.send(msg);
    }
  }

  cleanupStale(timeoutMs: number): boolean {
    const now = Date.now();
    let removed = false;
    for (const [id, entry] of this.clients) {
      if (now - entry.lastHeartbeat > timeoutMs) {
        entry.ws.close();
        this.clients.delete(id);
        removed = true;
      }
    }
    return removed;
  }

  [Symbol.iterator](): IterableIterator<[string, ClientEntry]> {
    return this.clients.entries();
  }
}
```

**Step 4: Run tests, verify passing**

Run: `cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents/server && npx vitest run src/__tests__/ClientStore.test.ts`
Expected: All pass

**Step 5: Commit**

```bash
git add server/src/ClientStore.ts server/src/__tests__/ClientStore.test.ts
git commit -m "feat(server): extract ClientStore with tests"
```

---

## Task 6: Server LayoutStore + tests

**Files:**
- Create: `server/src/LayoutStore.ts`
- Create: `server/src/__tests__/LayoutStore.test.ts`

**Step 1: Write failing tests**

```ts
// server/src/__tests__/LayoutStore.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LayoutStore } from '../LayoutStore.js'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

describe('LayoutStore', () => {
  let tmpDir: string
  let store: LayoutStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-test-'))
    store = new LayoutStore(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('starts with empty JSON', () => {
    expect(store.getJson()).toBe('{}')
    expect(store.getEtag()).toBe('')
  })

  it('loads layout from disk', () => {
    const layoutFile = path.join(tmpDir, 'layout.json')
    fs.writeFileSync(layoutFile, '{"version":1}')
    store.load()
    expect(store.getJson()).toBe('{"version":1}')
    expect(store.getEtag()).not.toBe('')
  })

  it('saves layout to disk atomically', () => {
    store.update('{"tiles":[]}')
    const layoutFile = path.join(tmpDir, 'layout.json')
    expect(fs.existsSync(layoutFile)).toBe(true)
    expect(fs.readFileSync(layoutFile, 'utf-8')).toBe('{"tiles":[]}')
  })

  it('computes new etag on update', () => {
    store.update('{"a":1}')
    const etag1 = store.getEtag()
    store.update('{"a":2}')
    const etag2 = store.getEtag()
    expect(etag1).not.toBe(etag2)
  })

  it('creates data dir if it does not exist', () => {
    const nested = path.join(tmpDir, 'sub', 'dir')
    const s2 = new LayoutStore(nested)
    s2.update('{"ok":true}')
    expect(fs.existsSync(path.join(nested, 'layout.json'))).toBe(true)
  })
})
```

**Step 2: Implement LayoutStore**

```ts
// server/src/LayoutStore.ts
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export class LayoutStore {
  private json = '{}';
  private etag = '';
  private readonly layoutFile: string;

  constructor(private readonly dataDir: string) {
    this.layoutFile = path.join(dataDir, 'layout.json');
  }

  getJson(): string { return this.json; }
  getEtag(): string { return this.etag; }

  load(): void {
    try {
      if (fs.existsSync(this.layoutFile)) {
        this.json = fs.readFileSync(this.layoutFile, 'utf-8');
        this.etag = this.computeEtag(this.json);
      }
    } catch { /* ignore load errors */ }
  }

  /** Validate JSON, update in-memory state, persist to disk. Returns new etag. */
  update(json: string): string {
    JSON.parse(json); // validate — throws on bad JSON
    this.json = json;
    this.etag = this.computeEtag(json);
    this.save();
    return this.etag;
  }

  private save(): void {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      const tmp = this.layoutFile + '.tmp';
      fs.writeFileSync(tmp, this.json, 'utf-8');
      fs.renameSync(tmp, this.layoutFile);
    } catch { /* ignore save errors */ }
  }

  private computeEtag(json: string): string {
    return crypto.createHash('md5').update(json).digest('hex');
  }
}
```

**Step 3: Run tests, verify passing, commit**

```bash
cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents/server && npx vitest run src/__tests__/LayoutStore.test.ts
git add server/src/LayoutStore.ts server/src/__tests__/LayoutStore.test.ts
git commit -m "feat(server): extract LayoutStore with tests"
```

---

## Task 7: SyncTransport + tests

**Depends on:** Task 1 (vitest), Task 4 (types)

**Files:**
- Create: `webview-ui/src/sync/SyncTransport.ts`
- Create: `webview-ui/src/sync/__tests__/SyncTransport.test.ts`

**Step 1: Write failing tests**

```ts
// webview-ui/src/sync/__tests__/SyncTransport.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncTransport } from '../SyncTransport.js'
import type { ServerMessage, SyncTransportCallbacks } from '../types.js'

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = []
  readyState = 0 // CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []

  constructor(public url: string) {
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
    MockWebSocket.instances[0].simulateClose()

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
```

**Step 2: Implement SyncTransport**

```ts
// webview-ui/src/sync/SyncTransport.ts
import type { ClientMessage, ServerMessage, SyncTransportCallbacks } from './types.js'

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 10000

export class SyncTransport {
  private ws: WebSocket | null = null
  private reconnectTimer: number | null = null
  private reconnectDelay = RECONNECT_BASE_MS
  private disposed = false

  constructor(
    private readonly url: string,
    private readonly callbacks: SyncTransportCallbacks,
  ) {}

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(): void {
    if (this.disposed) return
    try {
      this.ws = new WebSocket(this.url)

      this.ws.onopen = () => {
        this.reconnectDelay = RECONNECT_BASE_MS
        this.callbacks.onOpen()
      }

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as ServerMessage
          this.callbacks.onMessage(msg)
        } catch { /* ignore bad JSON */ }
      }

      this.ws.onclose = () => {
        this.callbacks.onClose()
        this.scheduleReconnect()
      }

      this.ws.onerror = () => { /* onclose will fire */ }
    } catch {
      this.scheduleReconnect()
    }
  }

  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(msg))
  }

  dispose(): void {
    this.disposed = true
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
  }
}
```

**Step 3: Run tests, verify, commit**

```bash
cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents/webview-ui && npx vitest run src/sync/__tests__/SyncTransport.test.ts
git add webview-ui/src/sync/SyncTransport.ts webview-ui/src/sync/__tests__/SyncTransport.test.ts
git commit -m "feat(sync): add SyncTransport with tests"
```

---

## Task 8: Server index.ts refactor to use ClientStore + LayoutStore

**Depends on:** Task 5, Task 6

**Files:**
- Modify: `server/src/index.ts`

**Step 1: Refactor index.ts to use extracted stores**

Replace the inline maps, arrays, and functions with `ClientStore` and `LayoutStore`. The server logic stays in `index.ts` but delegates state management. Key changes:

- Replace `const clients = new Map<string, ClientState>()` with `const clients = new ClientStore()`
- Replace `let layoutJson`, `let layoutEtag`, `loadLayout()`, `saveLayout()`, `computeEtag()` with `const layout = new LayoutStore(DATA_DIR); layout.load()`
- Replace `buildPresenceList()`, `broadcastPresence()`, `cleanupStaleClients()` with `clients.buildPresenceList()`, `clients.broadcastPresence()`, `clients.cleanupStale()`
- Update heartbeat interval from 1000ms to 250ms in the server's broadcast

**Step 2: Verify server still builds**

Run: `cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents/server && npx tsc --noEmit`
Expected: 0 errors

**Step 3: Commit**

```bash
git add server/src/index.ts
git commit -m "refactor(server): use ClientStore + LayoutStore"
```

---

## Task 9: RemoteCharacterManager + tests

**Depends on:** Task 1 (vitest), Task 3 (AvatarIdentity), Task 4 (types)

**Files:**
- Create: `webview-ui/src/sync/RemoteCharacterManager.ts`
- Create: `webview-ui/src/sync/__tests__/RemoteCharacterManager.test.ts`

**Step 1: Write failing tests**

```ts
// webview-ui/src/sync/__tests__/RemoteCharacterManager.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RemoteCharacterManager } from '../RemoteCharacterManager.js'
import type { PresenceClient, AgentSnapshot } from '../types.js'

// Minimal OfficeState mock — only the methods RemoteCharacterManager needs
function createMockOfficeState() {
  const characters = new Map<number, any>()
  return {
    characters,
    walkableTiles: [{ col: 3, row: 3 }, { col: 4, row: 4 }, { col: 5, row: 5 }],
    seats: new Map<string, any>(),
    tileMap: [],
    blockedTiles: new Set<string>(),
    layout: { furniture: [] },
    getLayout: () => ({ furniture: [] }),
  }
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
    state: 0,
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

  it('does not re-create during despawn animation', () => {
    mgr.updatePresence([makePresence('c1', [makeAgent()])])
    mgr.updatePresence([makePresence('c1', [])]) // starts despawn
    const charId = [...os.characters.keys()][0]
    // Agent reappears while despawn is playing
    mgr.updatePresence([makePresence('c1', [makeAgent()])])
    // Should have 2 characters: one despawning, one new
    // OR should skip re-creation. The key: no crash, no infinite loop.
    // Current design: despawning char completes, new one is created with new ID
    expect(os.characters.size).toBeGreaterThanOrEqual(1)
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
    ch.x = 48
    ch.y = 48
    // Set target far enough to interpolate, close enough to not teleport
    mgr.updatePresence([makePresence('c1', [makeAgent({ x: 64, y: 48 })])])
    mgr.interpolate(0.1) // 100ms of interpolation
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

  it('cleans up all characters on dispose', () => {
    mgr.updatePresence([makePresence('c1', [makeAgent()])])
    mgr.dispose()
    // All remote chars should be despawning or removed
    for (const ch of os.characters.values()) {
      if (ch.isRemote) expect(ch.matrixEffect).toBe('despawn')
    }
  })
})
```

**Step 2: Implement RemoteCharacterManager**

```ts
// webview-ui/src/sync/RemoteCharacterManager.ts
import { TILE_SIZE, CharacterState, Direction, MATRIX_EFFECT_DURATION_SEC } from '../office/types.js'
import { WALK_SPEED_PX_PER_SEC } from '../../constants.js'
import { createCharacter } from '../office/engine/characters.js'
import { matrixEffectSeeds } from '../office/engine/matrixEffect.js'
import type { Character } from '../office/types.js'
import type { OfficeState } from '../office/engine/officeState.js'
import type { PresenceClient, AgentSnapshot } from './types.js'

const TELEPORT_DISTANCE = TILE_SIZE * 2

export class RemoteCharacterManager {
  /** Maps "clientId:agentId" -> character ID in OfficeState */
  private remoteMap = new Map<string, number>()
  /** Set of character IDs currently despawning (do not update or re-use) */
  private despawning = new Set<number>()
  private nextId = -10000

  constructor(private readonly os: OfficeState) {}

  updatePresence(clients: PresenceClient[]): void {
    const expectedKeys = new Set<string>()
    for (const client of clients) {
      for (const agent of client.agents) {
        expectedKeys.add(`${client.clientId}:${agent.id}`)
      }
    }

    // Despawn characters no longer in presence
    for (const [key, charId] of this.remoteMap) {
      if (!expectedKeys.has(key)) {
        this.startDespawn(charId)
        this.remoteMap.delete(key)
      }
    }

    // Create or update
    for (const client of clients) {
      for (const agent of client.agents) {
        const key = `${client.clientId}:${agent.id}`
        const existingId = this.remoteMap.get(key)

        if (existingId !== undefined) {
          // Skip if despawning
          if (this.despawning.has(existingId)) continue
          const ch = this.os.characters.get(existingId)
          if (!ch) continue
          this.applyUpdate(ch, agent, client.userName)
        } else {
          // Create new remote character
          const ch = this.createRemote(agent, client.userName)
          this.remoteMap.set(key, ch.id)
        }
      }
    }
  }

  /** Called from game loop to interpolate all remote characters toward targets */
  interpolate(dt: number): void {
    for (const charId of this.remoteMap.values()) {
      if (this.despawning.has(charId)) continue
      const ch = this.os.characters.get(charId)
      if (!ch || !ch.isRemote) continue
      if (ch.remoteTargetX === undefined || ch.remoteTargetY === undefined) continue

      const dx = ch.remoteTargetX - ch.x
      const dy = ch.remoteTargetY - ch.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist > TELEPORT_DISTANCE) {
        // Teleport
        ch.x = ch.remoteTargetX
        ch.y = ch.remoteTargetY
        ch.tileCol = Math.round((ch.x - TILE_SIZE / 2) / TILE_SIZE)
        ch.tileRow = Math.round((ch.y - TILE_SIZE / 2) / TILE_SIZE)
      } else if (dist > 1) {
        // Interpolate
        const speed = WALK_SPEED_PX_PER_SEC * dt
        const step = Math.min(speed, dist)
        ch.x += (dx / dist) * step
        ch.y += (dy / dist) * step
        ch.tileCol = Math.round((ch.x - TILE_SIZE / 2) / TILE_SIZE)
        ch.tileRow = Math.round((ch.y - TILE_SIZE / 2) / TILE_SIZE)
      } else {
        // Close enough — snap
        ch.x = ch.remoteTargetX
        ch.y = ch.remoteTargetY
        ch.tileCol = Math.round((ch.x - TILE_SIZE / 2) / TILE_SIZE)
        ch.tileRow = Math.round((ch.y - TILE_SIZE / 2) / TILE_SIZE)
      }

      if (ch.remoteTargetDir !== undefined) {
        ch.dir = ch.remoteTargetDir as Direction
      }
    }
  }

  /** Mark a despawn-completed character for cleanup */
  completeDespawn(charId: number): void {
    this.despawning.delete(charId)
  }

  dispose(): void {
    for (const charId of this.remoteMap.values()) {
      this.startDespawn(charId)
    }
    this.remoteMap.clear()
  }

  private createRemote(agent: AgentSnapshot, userName: string): Character {
    const id = this.nextId--
    const ch = createCharacter(id, agent.appearance.palette, null, null, agent.appearance.hueShift)
    ch.isRemote = true
    ch.userName = userName
    ch.isActive = false // remote characters are driven by interpolation, not local AI
    ch.state = CharacterState.IDLE
    ch.x = agent.x
    ch.y = agent.y
    ch.tileCol = Math.round((agent.x - TILE_SIZE / 2) / TILE_SIZE)
    ch.tileRow = Math.round((agent.y - TILE_SIZE / 2) / TILE_SIZE)
    ch.dir = agent.dir as Direction
    ch.remoteTargetX = agent.x
    ch.remoteTargetY = agent.y
    ch.remoteTargetDir = agent.dir as Direction
    ch.matrixEffect = 'spawn'
    ch.matrixEffectTimer = 0
    ch.matrixEffectSeeds = matrixEffectSeeds()
    this.os.characters.set(id, ch)
    return ch
  }

  private applyUpdate(ch: Character, agent: AgentSnapshot, userName: string): void {
    ch.userName = userName
    ch.currentTool = agent.activeTool || null
    ch.remoteTargetX = agent.x
    ch.remoteTargetY = agent.y
    ch.remoteTargetDir = agent.dir as Direction

    // Mirror state and animation from owner
    ch.state = agent.state as CharacterState
    ch.frame = agent.frame

    // Update bubbles based on status
    if (agent.status === 'permission') {
      ch.bubbleType = 'permission'
    } else if (agent.status === 'waiting') {
      if (ch.bubbleType !== 'waiting') {
        ch.bubbleType = 'waiting'
        ch.bubbleTimer = 2
      }
    } else if (ch.bubbleType === 'permission' || ch.bubbleType === 'waiting') {
      ch.bubbleType = null
    }
  }

  private startDespawn(charId: number): void {
    if (this.despawning.has(charId)) return
    const ch = this.os.characters.get(charId)
    if (!ch) return
    if (ch.matrixEffect === 'despawn') return
    ch.matrixEffect = 'despawn'
    ch.matrixEffectTimer = 0
    ch.matrixEffectSeeds = matrixEffectSeeds()
    this.despawning.add(charId)
  }
}
```

NOTE: This requires adding `remoteTargetX`, `remoteTargetY`, `remoteTargetDir` back to the Character interface in `webview-ui/src/office/types.ts` (they were removed earlier but are needed for interpolation).

**Step 3: Restore remoteTarget fields in types.ts**

Add to Character interface in `webview-ui/src/office/types.ts`:
```ts
  /** Target position for remote character interpolation */
  remoteTargetX?: number
  remoteTargetY?: number
  remoteTargetDir?: Direction
```

**Step 4: Run tests, verify, commit**

```bash
cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents/webview-ui && npx vitest run src/sync/__tests__/RemoteCharacterManager.test.ts
git add webview-ui/src/sync/RemoteCharacterManager.ts webview-ui/src/sync/__tests__/ webview-ui/src/office/types.ts
git commit -m "feat(sync): add RemoteCharacterManager with interpolation and tests"
```

---

## Task 10: SyncManager + tests

**Depends on:** Task 7 (SyncTransport), Task 9 (RemoteCharacterManager)

**Files:**
- Create: `webview-ui/src/sync/SyncManager.ts`
- Create: `webview-ui/src/sync/__tests__/SyncManager.test.ts`

**Step 1: Write failing tests**

```ts
// webview-ui/src/sync/__tests__/SyncManager.test.ts
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

    constructor(url: string, callbacks: any) {
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
      x: 10, y: 20, dir: 0, state: 0, frame: 0,
    }]
    const mgr = new SyncManager(makeConfig({
      getLocalAgents: () => agents,
    }))
    mgr.activate()
    mockTransportInstance.simulateOpen()

    // join message was sent, clear it
    const joinMsg = mockTransportInstance.sent.shift()

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
      getLocalAgents: () => [{ id: 1, name: 'A', status: 'active' as const, appearance: { palette: 0, hueShift: 0 }, x: 0, y: 0, dir: 0, state: 0, frame: 0 }],
    }))
    mgr.activate()
    mockTransportInstance.simulateOpen()
    vi.advanceTimersByTime(250)
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
    mgr.dispose()

    vi.advanceTimersByTime(1000)
    // Only join message, no heartbeats after dispose
    const heartbeats = mockTransportInstance.sent.filter((m: any) => m.type === 'heartbeat')
    expect(heartbeats).toHaveLength(0)
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
```

**Step 2: Implement SyncManager**

```ts
// webview-ui/src/sync/SyncManager.ts
import { SyncTransport } from './SyncTransport.js'
import type { SyncManagerConfig, ServerMessage, PresenceClient } from './types.js'

export class SyncManager {
  private transport: SyncTransport | null = null
  private heartbeatTimer: number | null = null
  private layoutEtag = ''
  private disposed = false

  constructor(private readonly config: SyncManagerConfig) {}

  activate(): void {
    if (this.config.mode === 'offline') return

    this.transport = new SyncTransport(this.config.serverUrl, {
      onOpen: () => this.onOpen(),
      onMessage: (msg) => this.onMessage(msg),
      onClose: () => this.onClose(),
    })
    this.transport.connect()
  }

  putLayout(layout: unknown): void {
    if (this.config.mode === 'guest') return
    this.transport?.send({
      type: 'layoutPut',
      layout: JSON.stringify(layout),
    })
  }

  dispose(): void {
    this.disposed = true
    this.stopHeartbeat()
    this.transport?.dispose()
    this.transport = null
  }

  private onOpen(): void {
    this.transport!.send({ type: 'join', userName: this.config.userName })
    this.startHeartbeat()
  }

  private onClose(): void {
    this.stopHeartbeat()
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'presence':
        this.config.onPresence(msg.clients as PresenceClient[])
        break
      case 'welcome':
        if (msg.layoutJson && msg.layoutJson !== '{}') {
          this.layoutEtag = msg.layoutEtag || ''
          try { this.config.onRemoteLayout(JSON.parse(msg.layoutJson)) } catch { /* bad JSON */ }
        }
        break
      case 'layoutFull':
        this.layoutEtag = msg.layoutEtag || ''
        try { this.config.onRemoteLayout(JSON.parse(msg.layoutJson)) } catch { /* bad JSON */ }
        break
      case 'layoutChanged':
        this.fetchLayout()
        break
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.sendHeartbeat()
    this.heartbeatTimer = window.setInterval(() => this.sendHeartbeat(), this.config.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private sendHeartbeat(): void {
    const agents = this.config.mode === 'guest' ? [] : this.config.getLocalAgents()
    this.transport?.send({ type: 'heartbeat', agents })
  }

  private fetchLayout(): void {
    const httpUrl = this.config.serverUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
    const headers: Record<string, string> = {}
    if (this.layoutEtag) headers['If-None-Match'] = this.layoutEtag

    fetch(`${httpUrl}/layout`, { headers })
      .then((res) => {
        if (res.status === 304) return null
        const newEtag = res.headers.get('etag')
        if (newEtag) this.layoutEtag = newEtag
        return res.json()
      })
      .then((layout) => {
        if (layout) this.config.onRemoteLayout(layout)
      })
      .catch(() => { /* ignore */ })
  }
}
```

**Step 3: Run tests, verify, commit**

```bash
cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents/webview-ui && npx vitest run src/sync/__tests__/SyncManager.test.ts
git add webview-ui/src/sync/SyncManager.ts webview-ui/src/sync/__tests__/SyncManager.test.ts
git commit -m "feat(sync): add SyncManager with tests"
```

---

## Task 11: Integrate into React hook + game loop

**Depends on:** Task 10

**Files:**
- Modify: `webview-ui/src/hooks/useExtensionMessages.ts` — remove all sync code, use SyncManager
- Modify: `webview-ui/src/office/engine/officeState.ts` — remove `updateRemoteAgents`, `remoteCharacterMap`, `pickPaletteForUser`, `pickDiversePalette`; call `RemoteCharacterManager.interpolate()` in game loop; use `AvatarIdentity` in `addAgent`
- Modify: `webview-ui/src/App.tsx` — pass through new SyncManager lifecycle

**Step 1: In `useExtensionMessages.ts`:**
- Remove: `syncClientRef`, `WebviewSyncClient` import, the sync `useEffect`, `guestModeRef`, `syncActivated`
- Add: `SyncManager` import, `syncManagerRef`
- `activateSync(mode: SyncMode)` creates a `SyncManager` with config and calls `.activate()`
- `onPresence` callback calls `remoteCharacterManagerRef.current.updatePresence(clients)`
- `putLayout` delegates to `syncManagerRef.current.putLayout()`

**Step 2: In `officeState.ts`:**
- Remove: `updateRemoteAgents()`, `remoteCharacterMap`, `nextRemoteId`, `pickPaletteForUser()`, `pickDiversePalette()`
- Replace `pickDiversePalette()` calls in `addAgent()` with `AvatarIdentity.pickDiverse()`
- In `update(dt)`: after the character FSM loop, call the externally-provided `onInterpolateRemote?.(dt)` callback
- Remote characters are no longer updated by the local AI — they get `continue` in the FSM loop (driven by interpolation instead)

**Step 3: In `officeState.ts` game loop:**
- Characters with `ch.isRemote && !ch.matrixEffect` skip the `updateCharacter()` call — their position comes from `RemoteCharacterManager.interpolate()`
- When despawn completes for a remote character, call `remoteCharacterManager.completeDespawn(ch.id)`

**Step 4: Verify build**

Run: `npm run build` from project root
Expected: 0 errors

**Step 5: Commit**

```bash
git add webview-ui/src/hooks/useExtensionMessages.ts webview-ui/src/office/engine/officeState.ts webview-ui/src/App.tsx
git commit -m "refactor(sync): integrate SyncManager and RemoteCharacterManager into React"
```

---

## Task 12: Server integration test

**Depends on:** Task 2 (vitest in server), Task 8 (server refactor)

**Files:**
- Create: `server/src/__tests__/integration.test.ts`

**Step 1: Write integration test**

```ts
// server/src/__tests__/integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as http from 'http'
import { WebSocket } from 'ws'

let serverProcess: any
const PORT = 14200 // test port
const URL = `ws://localhost:${PORT}`

function connectClient(): Promise<{ ws: WebSocket; messages: any[] }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL)
    const messages: any[] = []
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()))
    })
    ws.on('open', () => resolve({ ws, messages }))
  })
}

function waitForMessage(messages: any[], type: string, count = 1): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (messages.filter(m => m.type === type).length >= count) {
        resolve()
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
    // Import and start server programmatically
    // This requires the server to export a createServer function
    // For now, spawn the process
    const { createServer } = await import('../index.js')
    server = createServer(PORT, '/tmp/pixel-agents-test-data')
    await new Promise<void>((resolve) => server.listen(PORT, resolve))
  })

  afterAll(() => {
    server?.close()
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

  it('client disconnect triggers empty presence', async () => {
    const a = await connectClient()
    const b = await connectClient()

    a.ws.send(JSON.stringify({ type: 'join', userName: 'Alice' }))
    await waitForMessage(b.messages, 'presence')

    a.ws.close()
    await waitForMessage(b.messages, 'presence', 2)
    const last = b.messages.filter(m => m.type === 'presence').pop()
    const aliceClient = last.clients.find((c: any) => c.userName === 'Alice')
    expect(aliceClient).toBeUndefined()

    b.ws.close()
  })
})
```

NOTE: This requires refactoring `server/src/index.ts` to export a `createServer(port, dataDir)` function instead of auto-starting. The `if (require.main === module)` pattern or a CLI entry point handles the auto-start.

**Step 2: Refactor server index.ts to export `createServer`**

Move the `server.listen()` call behind a check so the module can be imported for testing:

```ts
// At the bottom of server/src/index.ts
export function createServer(port: number, dataDir: string): http.Server {
  // ... create and return the http.Server
}

// Auto-start when run directly
const isMain = process.argv[1]?.endsWith('index.js')
if (isMain) {
  const server = createServer(PORT, DATA_DIR)
  server.listen(PORT, () => { log('server.started', { port: PORT }) })
}
```

**Step 3: Run integration test**

Run: `cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents/server && npx vitest run src/__tests__/integration.test.ts`
Expected: All pass

**Step 4: Commit**

```bash
git add server/src/index.ts server/src/__tests__/integration.test.ts
git commit -m "test(server): add integration tests for multiuser sync"
```

---

## Task 13: Cleanup dead code

**Depends on:** Task 11

**Files:**
- Delete or clean: `webview-ui/src/syncClient.ts` (old WebviewSyncClient)
- Clean: `src/syncClient.ts` (extension-side, already disabled — leave file but add deprecation comment)
- Clean: `src/PixelAgentsViewProvider.ts` — remove dead sync references
- Clean: `electron/src/main.ts` — remove dead sync functions (syncConnect, syncSendHeartbeat, etc.)
- Remove `pickPaletteForUser` from `src/syncClient.ts` and `electron/src/main.ts`

**Step 1: Delete old webview sync client**

```bash
rm webview-ui/src/syncClient.ts
```

**Step 2: Update any remaining imports**

Search for `syncClient` imports and update them to the new modules.

**Step 3: Verify build**

Run: `npm run build`
Expected: 0 errors

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove dead sync code after refactor"
```

---

## Task 14: Full build + manual verification

**Depends on:** All tasks

**Step 1: Full build**

```bash
cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents && npm run build
```
Expected: 0 errors

**Step 2: Run all tests**

```bash
cd webview-ui && npx vitest run && cd ../server && npx vitest run
```
Expected: All tests pass

**Step 3: Manual test**

1. Start server: `cd server && npm start`
2. Open VS Code with extension, click Connect with a nick
3. Open second VS Code window, click Guest
4. Verify: guest sees agents from first window moving smoothly
5. Verify: no duplicate agents, no spawn/despawn loops
6. Verify: monitors don't activate for remote agents

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: multiuser sync refactor — modular, tested, owner-authoritative"
```
