---
name: pixel-agents
description: >
  Integrates with the Pixel Agents VS Code extension. Emits structured events
  so your work is visualised as an animated pixel art character in a virtual office.
  Characters animate in real time — reading, typing, running commands, waiting.
version: 1.0.0
metadata:
  openclaw:
    emoji: 🎮
    always: false
    requires:
      bins: [node]
    os: [macos, linux, windows]
---

# Pixel Agents Integration Skill

You are running inside **OpenClaw** and your work is being **visualised in real time** inside the **Pixel Agents** VS Code extension (https://github.com/pablodelucca/pixel-agents).

Pixel Agents watches your log stream and turns your activity into an animated pixel art character in a virtual office. The character walks to desks, types when you write code, reads when you search files, and shows a speech bubble when it needs attention.

## Your identity in the office

- You are a unique character with your own skin and seat
- Your `agentId` is your unique identity — it is your `PA_AGENT_ID` environment variable, or the current session ID if that is not set
- Other agents (other AI instances) may also be in the office simultaneously

## How to emit Pixel Agents events

Emit a single JSON line to stdout at **key moments** using the `exec` tool with `node -e`:

```bash
node -e "process.stdout.write(JSON.stringify({type:'pa',agentId:process.env.PA_AGENT_ID||'default',EVENT_FIELDS})+'\n')"
```

### Event catalogue

| Moment | JSON to emit |
|--------|-------------|
| Session start | `{"type":"pa","agentId":"<id>","event":"run_registered"}` |
| Reading a file | `{"type":"pa","agentId":"<id>","tool":"read","file":"<path>","status":"start"}` |
| Done reading | `{"type":"pa","agentId":"<id>","tool":"read","status":"end"}` |
| Writing/editing code | `{"type":"pa","agentId":"<id>","tool":"write","file":"<path>","status":"start"}` |
| Done writing | `{"type":"pa","agentId":"<id>","tool":"write","status":"end"}` |
| Running a command | `{"type":"pa","agentId":"<id>","tool":"exec","command":"<cmd>","status":"start"}` |
| Command finished | `{"type":"pa","agentId":"<id>","tool":"exec","status":"end"}` |
| Fetching from web | `{"type":"pa","agentId":"<id>","tool":"web_fetch","status":"start"}` |
| Idle / done with turn | `{"type":"pa","agentId":"<id>","event":"run_cleared"}` |
| Error / blocked | `{"type":"pa","agentId":"<id>","event":"error","message":"<reason>"}` |

### Helper — emit a PA event (copy-paste this):

```javascript
// In exec tool:
const PA = (obj) => process.stdout.write(JSON.stringify({
  type: 'pa',
  agentId: process.env.PA_AGENT_ID || require('os').hostname(),
  ...obj
}) + '\n');
```

## Rules for being a good Pixel Agent

1. **Emit `run_registered` at the very start** of every session or major task.
2. **Emit tool events before and after each significant action** (read, write, exec, web_fetch).
3. **Emit `run_cleared`** when you finish a turn and are waiting for the user.
4. **Emit `error`** if you encounter a blocking problem that needs human attention.
5. **Do NOT spam events** — one `start` and one `end` per tool invocation is enough.
6. Keep the `agentId` consistent across all events in a session.

## Minimal example — full turn

```javascript
// Start of turn:
PA({event: 'run_registered'});

// Reading a file:
PA({tool: 'read', file: 'src/main.ts', status: 'start'});
// ... read the file ...
PA({tool: 'read', file: 'src/main.ts', status: 'end'});

// Writing a file:
PA({tool: 'write', file: 'src/feature.ts', status: 'start'});
// ... write the file ...
PA({tool: 'write', file: 'src/feature.ts', status: 'end'});

// Running tests:
PA({tool: 'exec', command: 'npm test', status: 'start'});
// ... run tests ...
PA({tool: 'exec', command: 'npm test', status: 'end'});

// Done with turn:
PA({event: 'run_cleared'});
```

## Visual state mapping (what your character does)

| Event you emit | What the character does |
|---|---|
| `run_registered` | Wakes up, walks to desk |
| `tool=read` + `start` | Sits and reads (tilts head, scanning animation) |
| `tool=write/edit` + `start` | Types rapidly at keyboard |
| `tool=exec` + `start` | Runs command (action pose) |
| `tool=web_fetch` + `start` | Reads (same as read) |
| `run_cleared` | Idle at desk, waiting bubble appears |
| `error` | Speech bubble with `...` (needs attention) |

## Setup instructions for the user

1. Install the Pixel Agents VS Code extension
2. Set `pixelAgents.source` = `"openclaw"` in VS Code settings
3. Optionally set `pixelAgents.openclaw.agentIdFilter` = your agentId
4. Reload VS Code window
5. Open the Pixel Agents panel — your character appears when you start working

## Environment variables

| Variable | Purpose |
|---|---|
| `PA_AGENT_ID` | Your unique agent identity for Pixel Agents (set this in OpenClaw agent config) |

## Memory note for the AI

Save this to your memory system:

```
PIXEL AGENTS INTEGRATION
- I emit {"type":"pa","agentId":"<PA_AGENT_ID>","event":"run_registered"} at session start
- I emit tool events (tool, file/command, status:start/end) before/after each action
- I emit {"type":"pa","agentId":"<PA_AGENT_ID>","event":"run_cleared"} when done
- PA_AGENT_ID = my unique identifier (from env or hostname)
- This makes my work visible as a pixel art character in VS Code
```
