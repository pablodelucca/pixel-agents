# Agent Chat System Design

**Goal:** Allow Claude agents to publish short text messages that appear as speech bubbles on their avatars, visible to all connected clients.

**Architecture:** File-based IPC (Claude → extension) + WebSocket relay (extension → server → all clients). No chat history stored.

---

## Data Flow

```
Claude terminal                Extension                    Server                     Other clients
     |                            |                           |                            |
     |  echo >> chat.jsonl        |                           |                            |
     |--------------------------->|                           |                            |
     |                  fs.watch detects line                 |                            |
     |                  maps session→agentId                  |                            |
     |                            |                           |                            |
     |                  postMessage to webview                |                            |
     |                            |------>SyncManager         |                            |
     |                            |       ws.send({           |                            |
     |                            |         type:'chat',      |                            |
     |                            |         agentId, msg      |                            |
     |                            |       })----------------->|                            |
     |                            |                           |  broadcast to all          |
     |                            |                           |--------------------------->|
     |                            |<--------------------------|                            |
     |                  show speech bubble 5s                 |                            |
```

## Components

### 1. Chat File Watcher (Extension)

- **File**: `~/.pixel-agents/chat.jsonl`
- **Format**: one JSON object per line: `{"session":"<uuid>","msg":"Hello!"}`
- Claude knows its session UUID (launched with `claude --session-id <uuid>`)
- Extension watches file with `fs.watch` + polling backup (same pattern as JSONL watcher)
- Maintains read offset — only processes new lines
- On new line: parse JSON, find agent by session UUID, send `postMessage({ type: 'agentChat', id, msg })` to webview
- File truncated on extension activation to avoid stale messages
- **Tested**

### 2. Protocol Messages

**ClientMessage (webview -> server):**
```ts
| { type: 'chat'; agentId: number; msg: string }
```

**ServerMessage (server -> all clients):**
```ts
| { type: 'chat'; clientId: string; agentId: number; userName: string; msg: string }
```

### 3. Server Relay

- Receives `chat` from client
- Attaches `clientId` and `userName` from sender's ClientEntry
- Broadcasts to **all** connected clients (including sender)
- No history stored — fire and forget
- **Tested**

### 4. SyncManager Changes

- New method or message handler for outbound chat: `sendChat(agentId, msg)`
- Receives `chat` ServerMessage, calls `onChat` callback
- **Tested**

### 5. RemoteCharacterManager Changes

- `applyChat(clientId, agentId, msg)`: finds remote character by `clientId:agentId`, sets `chatMessage` and `chatMessageTimer = 5`
- **Tested**

### 6. Character Model

New fields on `Character` interface:
```ts
chatMessage: string | null    // text to display
chatMessageTimer: number      // countdown from 5s to 0
```

Rules:
- Timer decrements each frame in character update
- When timer reaches 0, `chatMessage = null`
- New message replaces existing and resets timer
- Chat bubble has highest visual priority over permission/waiting bubbles

### 7. Speech Bubble Rendering

- Rendered in canvas (pixel art style)
- Dynamic width — adapts to text content, no truncation
- Max-width ~200px with word wrap
- Pixel font, white background, dark border
- Centered above character, above nick label

**Z-order (back to front):**
1. Desk (furniture)
2. Virtual monitor (tool animation + emoji)
3. Avatar (character sprite)
4. Speech bubble (chat / permission / waiting)

### 8. Local Echo

- When extension detects a chat from a local agent, the speech bubble is shown immediately (no server roundtrip wait)
- When the server echoes it back, the local client ignores it (match by own clientId)

## CLI Usage

Claude publishes a message by running:
```bash
echo '{"session":"<session-uuid>","msg":"Finished the refactor!"}' >> ~/.pixel-agents/chat.jsonl
```

## Testing

All components tested:
- Extension chat file watcher: parse, session mapping, offset tracking
- Server: receives chat, broadcasts with clientId/userName
- Server integration: client A sends chat, client B receives it
- SyncManager: sends chat, receives chat, calls onChat callback
- RemoteCharacterManager: applies chat to correct remote character
