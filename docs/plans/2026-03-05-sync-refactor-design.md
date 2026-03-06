# Multiuser Sync Refactor — Design

## Problem

The sync system has caused repeated bugs (duplicate connections, spawn/despawn loops, monitor activation, guest mode leaks, premature connections) because logic is spread across a 530-line React hook, a 1300-line god class, and duplicated functions in 3 codebases. No tests exist.

## Requirements

- Owner-authoritative positions: the client that owns an agent is the source of truth for position, direction, state, tool, animation
- 250ms heartbeat with interpolation on viewers
- Server stores state, validates, and relays
- Cross-client interactions (kamehameha, chat encounters)
- Guest mode: receive-only, no agent emission
- Modular avatar system extensible for future customization (hats, accessories)
- Typed sync message protocol
- Unit tests for every sync module
- Integration test: 2 clients against a real server

## Architecture

### Data Flow

```
Owner Client              Server                  Viewer Client
    |                        |                         |
    |-- heartbeat 250ms ---->| store state[owner]      |
    |   {agents: [{          |                         |
    |     id, x, y, dir,     |-- broadcast presence -->|
    |     state, tool,        |   {clients: [...]}     |
    |     palette, hueShift}]}|                         |
    |                        |                         |
    |                        |<-- heartbeat 250ms -----|
    |   store state[viewer]  |                         |
    |<-- broadcast presence --|                         |
```

### Module Structure

```
webview-ui/src/sync/
  SyncTransport.ts            WebSocket lifecycle (connect, send, reconnect, dispose)
  SyncManager.ts              Orchestration (activation, heartbeat timer, mode)
  RemoteCharacterManager.ts   Character CRUD + interpolation on OfficeState
  types.ts                    Shared sync interfaces
  __tests__/
    SyncTransport.test.ts
    SyncManager.test.ts
    RemoteCharacterManager.test.ts

webview-ui/src/avatar/
  AvatarIdentity.ts           Deterministic appearance from userName, diverse pick
  types.ts                    AvatarAppearance interface
  __tests__/
    AvatarIdentity.test.ts

server/src/
  index.ts                    HTTP + WebSocket server (cleaned up)
  ClientStore.ts              Connected clients map + timeout cleanup
  LayoutStore.ts              Layout file I/O + etag
  types.ts                    Server interfaces
  __tests__/
    ClientStore.test.ts
    LayoutStore.test.ts
    integration.test.ts       2 WS clients against real server
```

### Module Contracts

| Module | Input | Output | Does NOT touch |
|---|---|---|---|
| SyncTransport | URL, callbacks | events: open, message, close | OfficeState, characters |
| SyncManager | Transport + config | calls onPresence, onLayout; reads getLocalAgents | Does not create characters |
| RemoteCharacterManager | OfficeState + presence data | creates/interpolates/despawns characters | WebSocket, React state |
| AvatarIdentity | userName or existing appearances | AvatarAppearance | Sprites, cache |
| ClientStore | WS messages | presence broadcast | Layout, disk |
| LayoutStore | JSON strings | files on disk + etag | Clients |

### Interpolation

Remote characters receive position updates every 250ms. Between updates:
- If distance < 2 tiles: linear interpolation at WALK_SPEED toward target
- If distance >= 2 tiles: teleport (reconnection, layout change)
- Direction and animation state come from the owner's heartbeat
- When no update arrives for 2+ intervals (500ms): character keeps last known state
- After timeout (10s no heartbeat): server removes client, despawn triggered

### Guest Mode

A single flag `SyncMode = 'connect' | 'guest' | 'offline'` controls everything:
- `connect`: full sync, reports agents, pushes layout
- `guest`: connects to receive presence, sends empty agents[], ignores local agent messages
- `offline`: no WebSocket created

The mode is set exclusively by the WelcomeModal before any connection is established.

### Avatar System

```ts
interface AvatarAppearance {
  palette: number      // 0-5
  hueShift: number     // 0-360
  // future: hat?, accessory?, skinTone?
}

class AvatarIdentity {
  static fromUserName(name: string): AvatarAppearance   // deterministic hash
  static pickDiverse(existing: AvatarAppearance[]): AvatarAppearance
  static cacheKey(a: AvatarAppearance): string
}
```

Replaces: `pickPaletteForUser()` (3 copies), `pickDiversePalette()` in officeState.

### Typed Sync Messages

```ts
// Client -> Server
type ClientMessage =
  | { type: 'join'; userName: string }
  | { type: 'heartbeat'; agents: RemoteAgent[] }
  | { type: 'layoutPut'; layout: string }

// Server -> Client
type ServerMessage =
  | { type: 'welcome'; clientId: string; layoutJson: string; layoutEtag: string }
  | { type: 'presence'; clients: PresenceClient[] }
  | { type: 'layoutFull'; layoutJson: string; layoutEtag: string }
  | { type: 'layoutChanged'; etag: string }
```

### What Gets Deleted

- `webview-ui/src/syncClient.ts` — replaced by sync/ modules
- `src/syncClient.ts` — extension-side sync (already disabled)
- `pickPaletteForUser()` in officeState, extension, electron — replaced by AvatarIdentity
- `pickDiversePalette()` in officeState — moved to AvatarIdentity
- `updateRemoteAgents()` in officeState — moved to RemoteCharacterManager
- Sync-related code in useExtensionMessages — replaced by SyncManager integration
- `remoteCharacterMap`, `nextRemoteId` from officeState — moved to RemoteCharacterManager

### What Stays

- officeState.ts character CRUD (addAgent, removeAgent, setAgentActive) — local agents
- useExtensionMessages.ts — still handles non-sync messages (agent tools, layout, settings, assets)
- Server index.ts — simplified to use ClientStore + LayoutStore
- Electron sync code — disabled, same pattern as extension (webview handles it)

## Test Plan

### Unit Tests

**SyncTransport.test.ts**
- Connects and sends join message
- Reconnects on close with exponential backoff
- Disposes cleanly (no reconnect after dispose)
- Calls onMessage for each server message

**SyncManager.test.ts**
- Does not connect before activate()
- connect mode: sends heartbeat every 250ms with local agents
- guest mode: sends heartbeat with empty agents[]
- offline mode: no transport created
- Stops heartbeat on dispose
- Calls onPresence when presence message arrives
- Calls onLayout when layout message arrives

**RemoteCharacterManager.test.ts**
- Creates character on first presence with correct palette/position
- Updates position on subsequent presence (sets interpolation target)
- Despawns character when removed from presence
- Does not duplicate: same agent in consecutive updates = same character
- Despawn completes before character is deleted
- No re-creation during despawn animation
- Interpolates position between updates
- Teleports if distance > 2 tiles
- Remote characters can receive kamehameha/chat interactions

**AvatarIdentity.test.ts**
- Same userName always produces same appearance
- Different userNames produce different appearances (within reason)
- pickDiverse avoids existing palettes
- cacheKey is deterministic

### Integration Tests

**integration.test.ts** (server)
- Client A connects, sends heartbeat with 1 agent
- Client B connects, receives presence with A's agent
- Client A disconnects, Client B receives empty presence
- Layout put by A is received by B
- Stale client cleanup after timeout
- Guest client: sends empty agents, receives presence normally

## Scope Boundaries

IN scope:
- Extract sync to modular, tested code
- Extract AvatarIdentity
- Extract RemoteCharacterManager from officeState
- Type sync message protocol
- Extract sync code from useExtensionMessages
- Owner-authoritative positions with interpolation
- 250ms heartbeat
- Cross-client interactions
- Guest mode

OUT of scope:
- Splitting officeState beyond RemoteCharacterManager extraction
- Splitting PixelAgentsViewProvider
- Refactoring character FSM
- Typing the full extension<->webview message protocol
