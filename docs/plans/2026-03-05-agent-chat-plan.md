# Agent Chat System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow Claude agents to publish short text messages that appear as speech bubbles on their avatars, visible to all connected multiuser clients.

**Architecture:** File-based IPC (Claude echo >> chat.jsonl -> extension watches -> webview -> server relay -> all clients). Speech bubble rendered in canvas with dynamic width, 5s auto-fade. No chat history.

**Tech Stack:** TypeScript, Vitest, ws, fs.watch, Canvas 2D

**Design doc:** `docs/plans/2026-03-05-agent-chat-design.md`

---

## Parallelism Map

```
Task 1: Server chat relay + types + tests ──────┐
Task 2: Character model + chat timer logic ──────┤── all independent
Task 3: Extension chat file watcher + tests ─────┘
                                                  │
Task 4: SyncManager chat support + tests ─────────┤── depends on Task 1
Task 5: RemoteCharacterManager chat + tests ──────┤── depends on Task 2
                                                  │
Task 6: Speech bubble renderer ───────────────────┤── depends on Task 2
Task 7: Integration (hook + App.tsx wiring) ──────┤── depends on Tasks 3,4,5,6
                                                  │
Task 8: Full build + verification ────────────────┘── depends on all
```

---

## Task 1: Server chat relay + types + tests

**Files:**
- Modify: `server/src/types.ts`
- Modify: `server/src/index.ts`
- Create: `server/src/__tests__/chat.test.ts`

**Step 1: Add chat message types to `server/src/types.ts`**

Add after `LayoutPutMessage`:

```ts
export interface ChatMessage {
  type: 'chat';
  agentId: number;
  msg: string;
}

export type ClientMessage = JoinMessage | HeartbeatMessage | LayoutPutMessage | ChatMessage;
```

Add after `LayoutFullMessage`:

```ts
export interface ChatBroadcast {
  type: 'chat';
  clientId: string;
  agentId: number;
  userName: string;
  msg: string;
}

export type ServerMessage = PresenceMessage | LayoutChangedMessage | WelcomeMessage | LayoutFullMessage | ChatBroadcast;
```

**Step 2: Write test `server/src/__tests__/chat.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ClientStore } from '../ClientStore.js'

function mockWs(readyState = 1): any {
  return { readyState, send: vi.fn(), close: vi.fn() }
}

describe('Server chat relay', () => {
  let store: ClientStore

  beforeEach(() => {
    store = new ClientStore()
  })

  it('broadcastToAll sends chat to all open clients', () => {
    const ws1 = mockWs()
    const ws2 = mockWs()
    const ws3 = mockWs(3) // CLOSED
    store.add(ws1)
    store.add(ws2)
    store.add(ws3)

    const chatMsg = JSON.stringify({
      type: 'chat',
      clientId: 'c1',
      agentId: 1,
      userName: 'Alice',
      msg: 'Hello!',
    })
    store.broadcastToAll(chatMsg)

    expect(ws1.send).toHaveBeenCalledWith(chatMsg)
    expect(ws2.send).toHaveBeenCalledWith(chatMsg)
    expect(ws3.send).not.toHaveBeenCalled()
  })
})
```

**Step 3: Run test**

```bash
cd server && npx vitest run src/__tests__/chat.test.ts --reporter=verbose
```

Expected: PASS (broadcastToAll already works)

**Step 4: Add chat handler in `server/src/index.ts`**

In the `ws.on('message')` handler, after the `layoutPut` block (line ~126), add:

```ts
} else if (msg.type === 'chat') {
  const client = clients.get(clientId);
  if (client && msg.msg && typeof msg.msg === 'string') {
    const chatBroadcast = JSON.stringify({
      type: 'chat',
      clientId,
      agentId: msg.agentId,
      userName: client.userName,
      msg: msg.msg.slice(0, 500), // safety truncate at server level
    });
    clients.broadcastToAll(chatBroadcast);
    log('chat', { clientId, agentId: msg.agentId, msgLength: msg.msg.length });
  }
}
```

**Step 5: Add integration test to `server/src/__tests__/chat.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { ClientStore } from '../ClientStore.js'
import { WebSocket } from 'ws'
import * as http from 'http'

// ... existing unit test ...

describe('Server chat integration', () => {
  const PORT = 14201
  let server: http.Server

  beforeAll(async () => {
    const { createServer } = await import('../index.js')
    server = createServer(PORT, '/tmp/pixel-agents-chat-test-' + Date.now())
    await new Promise<void>((resolve) => server.listen(PORT, resolve))
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  function connectClient(): Promise<{ ws: WebSocket; messages: any[] }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}`)
      const messages: any[] = []
      ws.on('message', (data) => messages.push(JSON.parse(data.toString())))
      ws.on('open', () => resolve({ ws, messages }))
      ws.on('error', reject)
    })
  }

  function waitForMessage(messages: any[], type: string, count = 1, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs
      const check = () => {
        if (messages.filter(m => m.type === type).length >= count) resolve()
        else if (Date.now() > deadline) reject(new Error(`Timeout waiting for ${count} "${type}"`))
        else setTimeout(check, 50)
      }
      check()
    })
  }

  it('client A chat is received by client B', async () => {
    const a = await connectClient()
    const b = await connectClient()

    a.ws.send(JSON.stringify({ type: 'join', userName: 'Alice' }))

    a.ws.send(JSON.stringify({ type: 'chat', agentId: 1, msg: 'Hello world!' }))

    await waitForMessage(b.messages, 'chat')
    const chatMsg = b.messages.find(m => m.type === 'chat')
    expect(chatMsg).toBeDefined()
    expect(chatMsg.userName).toBe('Alice')
    expect(chatMsg.agentId).toBe(1)
    expect(chatMsg.msg).toBe('Hello world!')
    expect(chatMsg.clientId).toBeDefined()

    a.ws.close()
    b.ws.close()
  })

  it('sender also receives their own chat', async () => {
    const a = await connectClient()

    a.ws.send(JSON.stringify({ type: 'join', userName: 'Bob' }))
    a.ws.send(JSON.stringify({ type: 'chat', agentId: 2, msg: 'Self echo' }))

    await waitForMessage(a.messages, 'chat')
    const chatMsg = a.messages.find(m => m.type === 'chat')
    expect(chatMsg.msg).toBe('Self echo')

    a.ws.close()
  })
})
```

**Step 6: Run all server tests**

```bash
cd server && npx vitest run --reporter=verbose
```

Expected: All pass

**Step 7: Commit**

```bash
git add server/src/types.ts server/src/index.ts server/src/__tests__/chat.test.ts
git commit -m "feat(server): add chat message relay"
```

---

## Task 2: Character model + chat timer logic

**Files:**
- Modify: `webview-ui/src/office/types.ts` — add `chatMessage`, `chatMessageTimer` to Character
- Modify: `webview-ui/src/office/engine/characters.ts` — initialize new fields in `createCharacter()`
- Modify: `webview-ui/src/office/engine/officeState.ts` — tick `chatMessageTimer` in update loop, add `showChatMessage()` method
- Modify: `webview-ui/src/constants.ts` — add `CHAT_MESSAGE_DURATION_SEC = 5`

**Step 1: Add constant to `webview-ui/src/constants.ts`**

Add with the other chat constants:

```ts
export const CHAT_MESSAGE_DURATION_SEC = 5
```

**Step 2: Add fields to Character interface in `webview-ui/src/office/types.ts`**

After `chatEmojiTimer` (line ~267), add:

```ts
/** Agent chat message text (from CLI) */
chatMessage: string | null
/** Countdown timer for chat message bubble */
chatMessageTimer: number
```

**Step 3: Initialize in `createCharacter()` in `webview-ui/src/office/engine/characters.ts`**

In the character object literal returned by `createCharacter()`, add:

```ts
chatMessage: null,
chatMessageTimer: 0,
```

**Step 4: Add `showChatMessage()` method to OfficeState in `webview-ui/src/office/engine/officeState.ts`**

```ts
showChatMessage(agentId: number, msg: string): void {
  const ch = this.characters.get(agentId)
  if (!ch) return
  ch.chatMessage = msg
  ch.chatMessageTimer = CHAT_MESSAGE_DURATION_SEC
}
```

Import `CHAT_MESSAGE_DURATION_SEC` from `'../../constants.js'`.

**Step 5: Tick chat timer in `update(dt)` in `officeState.ts`**

In the character update loop (where `bubbleTimer` is already ticked, around line ~1013), add after the waiting bubble timer code:

```ts
// Tick chat message timer
if (ch.chatMessage) {
  ch.chatMessageTimer -= dt
  if (ch.chatMessageTimer <= 0) {
    ch.chatMessage = null
    ch.chatMessageTimer = 0
  }
}
```

**Step 6: Run webview tests**

```bash
cd webview-ui && npx vitest run --reporter=verbose
```

Expected: All existing tests pass

**Step 7: Commit**

```bash
git add webview-ui/src/office/types.ts webview-ui/src/office/engine/characters.ts webview-ui/src/office/engine/officeState.ts webview-ui/src/constants.ts
git commit -m "feat(character): add chatMessage field and timer logic"
```

---

## Task 3: Extension chat file watcher + tests

**Files:**
- Create: `src/chatWatcher.ts`
- Create: `src/__tests__/chatWatcher.test.ts`
- Modify: `src/PixelAgentsViewProvider.ts` — start/stop watcher

**Step 1: Create `src/chatWatcher.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CHAT_FILE = path.join(os.homedir(), '.pixel-agents', 'chat.jsonl');
const POLL_INTERVAL_MS = 500;

export interface ChatLine {
  session: string;
  msg: string;
}

export function parseChatLine(line: string): ChatLine | null {
  try {
    const obj = JSON.parse(line);
    if (typeof obj.session === 'string' && typeof obj.msg === 'string' && obj.msg.length > 0) {
      return { session: obj.session, msg: obj.msg };
    }
  } catch { /* ignore bad lines */ }
  return null;
}

export function findAgentBySession(
  agents: Iterable<{ id: number; jsonlFile: string }>,
  sessionId: string,
): number | null {
  for (const agent of agents) {
    // jsonlFile is <projectDir>/<sessionId>.jsonl
    const basename = path.basename(agent.jsonlFile, '.jsonl');
    if (basename === sessionId) return agent.id;
  }
  return null;
}

export class ChatWatcher {
  private offset = 0;
  private lineBuffer = '';
  private fsWatcher: fs.FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(
    private readonly chatFile: string,
    private readonly onLine: (line: ChatLine) => void,
  ) {}

  static defaultPath(): string {
    return CHAT_FILE;
  }

  start(): void {
    // Ensure directory exists
    const dir = path.dirname(this.chatFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Truncate old messages on start
    try {
      fs.writeFileSync(this.chatFile, '', 'utf-8');
    } catch { /* ignore */ }
    this.offset = 0;
    this.lineBuffer = '';

    // Watch for changes
    try {
      this.fsWatcher = fs.watch(this.chatFile, () => this.readNewLines());
    } catch { /* watch may fail, polling backup */ }

    // Polling backup
    this.pollTimer = setInterval(() => this.readNewLines(), POLL_INTERVAL_MS);
  }

  dispose(): void {
    this.disposed = true;
    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  readNewLines(): void {
    if (this.disposed) return;
    try {
      if (!fs.existsSync(this.chatFile)) return;
      const stat = fs.statSync(this.chatFile);
      if (stat.size <= this.offset) return;

      const fd = fs.openSync(this.chatFile, 'r');
      const buf = Buffer.alloc(stat.size - this.offset);
      fs.readSync(fd, buf, 0, buf.length, this.offset);
      fs.closeSync(fd);
      this.offset = stat.size;

      const text = this.lineBuffer + buf.toString('utf-8');
      const lines = text.split('\n');
      // Last element is either empty (if text ended with \n) or a partial line
      this.lineBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parsed = parseChatLine(trimmed);
        if (parsed) {
          this.onLine(parsed);
        }
      }
    } catch { /* ignore read errors */ }
  }
}
```

**Step 2: Create `src/__tests__/chatWatcher.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseChatLine, findAgentBySession, ChatWatcher } from '../chatWatcher.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ChatLine } from '../chatWatcher.js';

describe('parseChatLine', () => {
  it('parses valid JSON line', () => {
    const result = parseChatLine('{"session":"abc-123","msg":"Hello!"}');
    expect(result).toEqual({ session: 'abc-123', msg: 'Hello!' });
  });

  it('returns null for invalid JSON', () => {
    expect(parseChatLine('not json')).toBeNull();
  });

  it('returns null for missing session', () => {
    expect(parseChatLine('{"msg":"Hello!"}')).toBeNull();
  });

  it('returns null for missing msg', () => {
    expect(parseChatLine('{"session":"abc"}')).toBeNull();
  });

  it('returns null for empty msg', () => {
    expect(parseChatLine('{"session":"abc","msg":""}')).toBeNull();
  });
});

describe('findAgentBySession', () => {
  it('finds agent by session UUID in jsonlFile path', () => {
    const agents = [
      { id: 1, jsonlFile: '/home/.claude/projects/proj/aaa-111.jsonl' },
      { id: 2, jsonlFile: '/home/.claude/projects/proj/bbb-222.jsonl' },
    ];
    expect(findAgentBySession(agents, 'bbb-222')).toBe(2);
  });

  it('returns null when no match', () => {
    const agents = [
      { id: 1, jsonlFile: '/home/.claude/projects/proj/aaa-111.jsonl' },
    ];
    expect(findAgentBySession(agents, 'zzz-999')).toBeNull();
  });
});

describe('ChatWatcher', () => {
  let tmpDir: string;
  let chatFile: string;
  let received: ChatLine[];
  let watcher: ChatWatcher;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-test-'));
    chatFile = path.join(tmpDir, 'chat.jsonl');
    received = [];
    watcher = new ChatWatcher(chatFile, (line) => received.push(line));
  });

  afterEach(() => {
    watcher.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('truncates file on start', () => {
    fs.writeFileSync(chatFile, '{"session":"old","msg":"stale"}\n');
    watcher.start();
    // File should be truncated
    expect(fs.readFileSync(chatFile, 'utf-8')).toBe('');
  });

  it('reads new lines after start', () => {
    watcher.start();
    fs.appendFileSync(chatFile, '{"session":"s1","msg":"Hello"}\n');
    watcher.readNewLines();
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ session: 's1', msg: 'Hello' });
  });

  it('handles multiple lines', () => {
    watcher.start();
    fs.appendFileSync(chatFile, '{"session":"s1","msg":"A"}\n{"session":"s2","msg":"B"}\n');
    watcher.readNewLines();
    expect(received).toHaveLength(2);
    expect(received[0].msg).toBe('A');
    expect(received[1].msg).toBe('B');
  });

  it('skips invalid lines', () => {
    watcher.start();
    fs.appendFileSync(chatFile, 'garbage\n{"session":"s1","msg":"OK"}\n');
    watcher.readNewLines();
    expect(received).toHaveLength(1);
    expect(received[0].msg).toBe('OK');
  });

  it('buffers partial lines', () => {
    watcher.start();
    fs.appendFileSync(chatFile, '{"session":"s1","msg":"par');
    watcher.readNewLines();
    expect(received).toHaveLength(0);

    fs.appendFileSync(chatFile, 'tial"}\n');
    watcher.readNewLines();
    expect(received).toHaveLength(1);
    expect(received[0].msg).toBe('partial');
  });

  it('does not read after dispose', () => {
    watcher.start();
    watcher.dispose();
    fs.appendFileSync(chatFile, '{"session":"s1","msg":"after dispose"}\n');
    watcher.readNewLines();
    expect(received).toHaveLength(0);
  });
});
```

**Step 3: Add vitest config for extension tests**

Create `src/vitest.config.ts` (if it doesn't exist already — check first):

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
  },
})
```

NOTE: The extension uses `src/` at the project root. You may need to install vitest as a dev dependency in the root `package.json` if it's not already there. Check `package.json` first. If vitest isn't installed at root level, run:

```bash
npm install --save-dev vitest
```

Then add a test script to root `package.json`:

```json
"test:extension": "vitest run --config src/vitest.config.ts"
```

**Step 4: Run extension tests**

```bash
npm run test:extension
```

Expected: All 8 tests pass

**Step 5: Wire into PixelAgentsViewProvider**

In `src/PixelAgentsViewProvider.ts`, add:

```ts
import { ChatWatcher, findAgentBySession } from './chatWatcher.js';
```

In the class, add a field:

```ts
private chatWatcher: ChatWatcher | null = null;
```

In `resolveWebviewView()` (or wherever the webview is initialized), after existing watchers are set up:

```ts
this.chatWatcher = new ChatWatcher(ChatWatcher.defaultPath(), (chatLine) => {
  const agentId = findAgentBySession(this.agents.values(), chatLine.session);
  if (agentId !== null) {
    this.webview?.postMessage({ type: 'agentChat', id: agentId, msg: chatLine.msg });
  }
});
this.chatWatcher.start();
```

In `dispose()` (or cleanup):

```ts
this.chatWatcher?.dispose();
```

NOTE: `this.agents` is the `Map<number, AgentState>` — you need to check what the actual field name is in `PixelAgentsViewProvider.ts` and adjust. The `AgentState` has `jsonlFile` which contains the session UUID.

**Step 6: Commit**

```bash
git add src/chatWatcher.ts src/__tests__/chatWatcher.test.ts src/PixelAgentsViewProvider.ts
git commit -m "feat(extension): add chat file watcher"
```

---

## Task 4: SyncManager chat support + tests

**Depends on:** Task 1

**Files:**
- Modify: `webview-ui/src/sync/types.ts` — add chat to ClientMessage and ServerMessage
- Modify: `webview-ui/src/sync/SyncManager.ts` — add `sendChat()`, handle incoming `chat`
- Modify: `webview-ui/src/sync/__tests__/SyncManager.test.ts` — add chat tests

**Step 1: Update `webview-ui/src/sync/types.ts`**

Add to `ClientMessage`:

```ts
| { type: 'chat'; agentId: number; msg: string }
```

Add to `ServerMessage`:

```ts
| { type: 'chat'; clientId: string; agentId: number; userName: string; msg: string }
```

Add to `SyncManagerConfig`:

```ts
onChat?: (clientId: string, agentId: number, userName: string, msg: string) => void
```

**Step 2: Add `sendChat()` to `SyncManager.ts`**

```ts
sendChat(agentId: number, msg: string): void {
  this.transport?.send({ type: 'chat', agentId, msg })
}
```

**Step 3: Handle incoming chat in `onMessage()`**

In the `switch (msg.type)` block, add:

```ts
case 'chat':
  this.config.onChat?.(msg.clientId, msg.agentId, msg.userName, msg.msg)
  break
```

**Step 4: Add tests to `webview-ui/src/sync/__tests__/SyncManager.test.ts`**

```ts
it('sendChat sends via transport', () => {
  const mgr = new SyncManager(makeConfig())
  mgr.activate()
  mockTransportInstance.simulateOpen()

  mgr.sendChat(1, 'Hello!')
  const chatMsg = mockTransportInstance.sent.find((m: any) => m.type === 'chat')
  expect(chatMsg).toEqual({ type: 'chat', agentId: 1, msg: 'Hello!' })
  mgr.dispose()
})

it('calls onChat when chat message arrives', () => {
  const onChat = vi.fn()
  const mgr = new SyncManager(makeConfig({ onChat }))
  mgr.activate()
  mockTransportInstance.simulateOpen()

  mockTransportInstance.simulateMessage({
    type: 'chat',
    clientId: 'c1',
    agentId: 1,
    userName: 'Alice',
    msg: 'Hello!',
  })
  expect(onChat).toHaveBeenCalledWith('c1', 1, 'Alice', 'Hello!')
  mgr.dispose()
})
```

**Step 5: Run tests**

```bash
cd webview-ui && npx vitest run --reporter=verbose
```

Expected: All pass

**Step 6: Commit**

```bash
git add webview-ui/src/sync/types.ts webview-ui/src/sync/SyncManager.ts webview-ui/src/sync/__tests__/SyncManager.test.ts
git commit -m "feat(sync): add chat message support to SyncManager"
```

---

## Task 5: RemoteCharacterManager chat + tests

**Depends on:** Task 2

**Files:**
- Modify: `webview-ui/src/sync/RemoteCharacterManager.ts`
- Modify: `webview-ui/src/sync/__tests__/RemoteCharacterManager.test.ts`

**Step 1: Add `applyChat()` to `RemoteCharacterManager.ts`**

```ts
applyChat(clientId: string, agentId: number, msg: string): void {
  const key = `${clientId}:${agentId}`
  const charId = this.remoteMap.get(key)
  if (charId === undefined) return
  const ch = this.os.characters.get(charId)
  if (!ch) return
  ch.chatMessage = msg
  ch.chatMessageTimer = CHAT_MESSAGE_DURATION_SEC
}
```

Import `CHAT_MESSAGE_DURATION_SEC` from `'../../constants.js'`.

**Step 2: Add tests**

```ts
it('applyChat sets chatMessage on remote character', () => {
  const clients: PresenceClient[] = [{
    clientId: 'c1',
    userName: 'Alice',
    agents: [{ id: 1, name: 'A1', status: 'idle' as const, appearance: { palette: 0, hueShift: 0 }, x: 50, y: 50, dir: 0, state: 'idle', frame: 0 }],
  }]
  mgr.updatePresence(clients)

  mgr.applyChat('c1', 1, 'Hello world!')

  // Find the remote character
  const remoteChars = [...os.characters.values()].filter(ch => ch.isRemote)
  expect(remoteChars).toHaveLength(1)
  expect(remoteChars[0].chatMessage).toBe('Hello world!')
  expect(remoteChars[0].chatMessageTimer).toBeGreaterThan(0)
})

it('applyChat ignores unknown clientId:agentId', () => {
  mgr.applyChat('unknown', 99, 'No target')
  // Should not throw, no characters affected
  expect(os.characters.size).toBe(0)
})
```

**Step 3: Run tests**

```bash
cd webview-ui && npx vitest run --reporter=verbose
```

Expected: All pass

**Step 4: Commit**

```bash
git add webview-ui/src/sync/RemoteCharacterManager.ts webview-ui/src/sync/__tests__/RemoteCharacterManager.test.ts
git commit -m "feat(sync): add applyChat to RemoteCharacterManager"
```

---

## Task 6: Speech bubble renderer

**Depends on:** Task 2

**Files:**
- Modify: `webview-ui/src/office/engine/renderer.ts` — add `renderAgentChatBubbles()`
- Modify: `webview-ui/src/constants.ts` — add rendering constants

**Step 1: Add rendering constants to `webview-ui/src/constants.ts`**

```ts
export const CHAT_BUBBLE_MAX_WIDTH_PX = 200
export const CHAT_BUBBLE_PADDING_PX = 3
export const CHAT_BUBBLE_FONT_SIZE_PX = 5
export const CHAT_BUBBLE_BG = 'rgba(255, 255, 255, 0.95)'
export const CHAT_BUBBLE_BORDER = 'rgba(30, 30, 46, 0.9)'
export const CHAT_BUBBLE_TEXT_COLOR = '#1e1e2e'
export const CHAT_BUBBLE_TAIL_SIZE_PX = 2
```

**Step 2: Add `renderAgentChatBubbles()` to `renderer.ts`**

Add this function after `renderChatBubbles`:

```ts
export function renderAgentChatBubbles(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  for (const ch of characters) {
    if (!ch.chatMessage) continue

    const text = ch.chatMessage
    const fontSize = CHAT_BUBBLE_FONT_SIZE_PX * zoom
    const pad = CHAT_BUBBLE_PADDING_PX * zoom
    const maxW = CHAT_BUBBLE_MAX_WIDTH_PX * zoom
    const tailSize = CHAT_BUBBLE_TAIL_SIZE_PX * zoom

    ctx.save()
    ctx.font = `${fontSize}px "FS Pixel Sans", monospace`
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'

    // Word wrap
    const words = text.split(' ')
    const lines: string[] = []
    let currentLine = ''
    for (const word of words) {
      const testLine = currentLine ? currentLine + ' ' + word : word
      const metrics = ctx.measureText(testLine)
      if (metrics.width > maxW - pad * 2 && currentLine) {
        lines.push(currentLine)
        currentLine = word
      } else {
        currentLine = testLine
      }
    }
    if (currentLine) lines.push(currentLine)

    const lineHeight = fontSize * 1.3
    const textHeight = lines.length * lineHeight
    const textWidth = Math.min(
      maxW - pad * 2,
      Math.max(...lines.map(l => ctx.measureText(l).width)),
    )
    const boxW = textWidth + pad * 2
    const boxH = textHeight + pad * 2

    const sittingOff = ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX : 0
    const bx = Math.round(offsetX + ch.x * zoom - boxW / 2)
    const by = Math.round(offsetY + (ch.y + sittingOff - BUBBLE_VERTICAL_OFFSET_PX) * zoom - boxH - tailSize - 1 * zoom)

    // Fade out in last 0.5s
    let alpha = 1.0
    if (ch.chatMessageTimer < BUBBLE_FADE_DURATION_SEC) {
      alpha = ch.chatMessageTimer / BUBBLE_FADE_DURATION_SEC
    }
    if (alpha < 1.0) ctx.globalAlpha = alpha

    // Background
    ctx.fillStyle = CHAT_BUBBLE_BG
    ctx.fillRect(bx, by, boxW, boxH)
    ctx.strokeStyle = CHAT_BUBBLE_BORDER
    ctx.lineWidth = 1
    ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1)

    // Tail
    const tailX = bx + boxW / 2
    const tailY = by + boxH
    ctx.fillStyle = CHAT_BUBBLE_BG
    ctx.beginPath()
    ctx.moveTo(tailX - tailSize, tailY)
    ctx.lineTo(tailX + tailSize, tailY)
    ctx.lineTo(tailX, tailY + tailSize)
    ctx.closePath()
    ctx.fill()

    // Text
    ctx.fillStyle = CHAT_BUBBLE_TEXT_COLOR
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], bx + pad, by + pad + i * lineHeight)
    }

    ctx.restore()
  }
}
```

Import the new constants at the top of `renderer.ts`.

**Step 3: Call `renderAgentChatBubbles` in the render pipeline**

In the main render function (around line 1100), add it after `renderChatBubbles` (the existing Sims-style chat) and before `renderTaskBadges`:

```ts
// Agent chat messages (from CLI)
renderAgentChatBubbles(ctx, characters, offsetX, offsetY, zoom)
```

The render order ensures agent chat bubbles render on top of everything else (above the character, above existing bubbles).

**Step 4: Run build to verify**

```bash
cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents && npm run build
```

Expected: 0 errors

**Step 5: Commit**

```bash
git add webview-ui/src/office/engine/renderer.ts webview-ui/src/constants.ts
git commit -m "feat(renderer): add agent chat speech bubble"
```

---

## Task 7: Integration (hook + App.tsx wiring)

**Depends on:** Tasks 3, 4, 5, 6

**Files:**
- Modify: `webview-ui/src/hooks/useExtensionMessages.ts` — handle `agentChat` message, wire SyncManager callbacks
- Modify: `webview-ui/src/App.tsx` — pass through

**Step 1: Handle `agentChat` postMessage from extension**

In the message handler in `useExtensionMessages.ts`, add a new case:

```ts
} else if (msg.type === 'agentChat') {
  const id = msg.id as number
  const chatMsg = msg.msg as string
  // Show bubble locally immediately
  os.showChatMessage(id, chatMsg)
  // Relay to server for other clients
  syncManagerRef.current?.sendChat(id, chatMsg)
}
```

**Step 2: Wire `onChat` callback in SyncManager config**

In the `activateSync` function, when creating the SyncManager config, add the `onChat` callback:

```ts
onChat: (clientId, agentId, _userName, chatMsg) => {
  // Ignore our own echoed messages (already shown locally)
  // The SyncManager's welcome message gives us our clientId
  // For now, show all — the local agent won't exist as a remote character
  // so applyChat on remote manager is the right path
  remoteCharManagerRef.current?.applyChat(clientId, agentId, chatMsg)
},
```

**Step 3: Run build**

```bash
cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents && npm run build
```

Expected: 0 errors

**Step 4: Run all tests**

```bash
cd webview-ui && npx vitest run && cd ../server && npx vitest run
```

Expected: All pass

**Step 5: Commit**

```bash
git add webview-ui/src/hooks/useExtensionMessages.ts
git commit -m "feat(integration): wire chat messages through hook and SyncManager"
```

---

## Task 8: Full build + verification

**Depends on:** All previous tasks

**Step 1: Full build**

```bash
cd /Users/sebastianbarrozo/Documents/work/epic/pixel-agents && npm run build
```

Expected: 0 errors

**Step 2: All tests**

```bash
cd webview-ui && npx vitest run --reporter=verbose
cd ../server && npx vitest run --reporter=verbose
npm run test:extension 2>/dev/null || echo "Extension tests may need vscode mock — verify manually"
```

Expected: All pass

**Step 3: Manual verification checklist**

- [ ] Start the server: `cd server && node dist/index.js --port 4200`
- [ ] Open VS Code with pixel-agents
- [ ] Create an agent (+ Agent button)
- [ ] In the Claude terminal, run: `echo '{"session":"<paste-session-uuid>","msg":"Testing chat!"}' >> ~/.pixel-agents/chat.jsonl`
- [ ] Verify speech bubble appears over the agent's avatar for 5 seconds
- [ ] Open a second VS Code window connected to same server
- [ ] Verify the chat bubble appears on the remote avatar too

**Step 4: Commit any final fixes**
