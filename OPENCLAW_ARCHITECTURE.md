# OpenClaw Source Mode — Architecture Note

## Where OpenClaw was coupled

The integration touches exactly **one layer**: event ingestion.
The entire UI (canvas, sprites, animations, layout editor, office engine) is untouched.

---

## New files

```
src/event-sources/
├── types.ts      ← EventSourceType union + OpenClawLogEntry interface
├── registry.ts   ← Reads VS Code config (pixelAgents.source / agentIdFilter)
└── openclaw.ts   ← OpenClawEventSource class (the actual provider)
```

### `types.ts`
Two exports:
- `EventSourceType` — `"claude" | "openclaw"` discriminator.
- `OpenClawLogEntry` — flexible interface for one JSON log line.
  Accepts both `agentId` and `run_id` as the run identifier, plus optional `tool`, `event`, `status`, `file`, `command`, `toolId`, `message`.

### `registry.ts`
Two thin helpers that wrap `vscode.workspace.getConfiguration`:
- `getConfiguredSourceType()` → `EventSourceType`
- `getOpenClawAgentIdFilter()` → `string | undefined`

### `openclaw.ts`
`OpenClawEventSource` class:

1. **Spawns** `openclaw logs --follow --json` as a child process via `child_process.spawn`.
2. **Buffers** stdout line-by-line; parses each line as JSON.
3. **Filters** lines by `agentId` when `agentIdFilter` is set.
4. **Classifies** each entry into one of six outcomes:

   | Condition | Outcome |
   |---|---|
   | `tool=read / web_fetch` | `agentToolStart` — status "Reading…" |
   | `tool=write / edit` | `agentToolStart` — status "Editing…" |
   | `tool=exec` | `agentToolStart` — status "Running: …" |
   | `event=run_registered` | `agentStatus:active` |
   | `event=run_cleared` | `agentStatus:waiting` |
   | `event=error / timeout` | `agentToolPermission` |

5. **Creates synthetic agents** on first contact with a new `openclawId`: allocates a numeric pixel-agent ID from the shared counter, inserts a `AgentState` with `terminalRef: undefined`, and posts `agentCreated` to the webview.
6. **Tracks one synthetic tool at a time** per run (clears previous tool before starting a new one with a 300 ms `agentToolDone` delay — matching the Claude pipeline's `TOOL_DONE_DELAY_MS`).
7. **Auto-restarts** the process 3 s after it exits (network blip / crash resilience).
8. **Falls back** to a VS Code warning if the `openclaw` binary is not found.

---

## Modified files

| File | Change |
|---|---|
| `src/types.ts` | `terminalRef?: vscode.Terminal` (optional); new `openclawAgentId?: string` |
| `src/agentManager.ts` | `persistAgents()` skips agents where `terminalRef` is undefined (synthetic agents are not persisted) |
| `src/PixelAgentsViewProvider.ts` | Imports registry + provider; branches on `sourceType` in `webviewReady`; null-guards all `terminalRef` usages; disposes source in `dispose()` |
| `package.json` | `contributes.configuration` with `pixelAgents.source` and `pixelAgents.openclaw.agentIdFilter` |
| `README.md` | New "OpenClaw source mode" section |

---

## Claude mode — zero regression guarantee

`getConfiguredSourceType()` returns `"claude"` when the setting is absent.
In that branch, **none of the new code runs**: `restoreAgents`, `ensureProjectScan`, file watching, and terminal lifecycle all execute exactly as before.

The only shared change is making `terminalRef` optional in `AgentState`, which is backward-compatible — existing Claude agents always have a terminal, and all usages now check `agent.terminalRef?.` before calling `.show()` / `.dispose()`.

---

## Message protocol compatibility

`OpenClawEventSource` posts the same webview messages as the Claude pipeline:

```
agentCreated       { id }
agentStatus        { id, status: 'active' | 'waiting' }
agentToolStart     { id, toolId, status }
agentToolDone      { id, toolId }
agentToolPermission { id }
```

No new message types were added; the webview state machine is driven identically in both modes.
