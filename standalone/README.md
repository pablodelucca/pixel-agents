# Pixel Agents Standalone

Run [Pixel Agents](https://github.com/pablodelucca/pixel-agents) outside VS Code — in any browser. Watch your Claude Code AI agents work as animated pixel characters in a virtual office, no matter which terminal you use (Warp, iTerm, Hyper, native Terminal, etc.).

This is a standalone port of the Pixel Agents VS Code extension. It runs as a Node.js server that serves the same React webview via WebSocket instead of VS Code's postMessage API.

## Why?

The original Pixel Agents only works inside VS Code's integrated terminal. If you use Warp, iTerm, or any other terminal, your Claude Code agents are invisible to Pixel Agents.

This standalone version scans `~/.claude/projects/` for active JSONL session files — regardless of which terminal created them — and displays all your agents in the pixel office.

## Prerequisites

- Node.js 18+
- [Pixel Agents VS Code extension](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents) installed (we reuse its built assets)
- Claude Code CLI installed

## Setup

```bash
# Clone this repo
git clone https://github.com/YOUR_USER/pixel-agents-standalone.git
cd pixel-agents-standalone

# Install dependencies
npm install

# Build (copies assets from the installed VS Code extension)
node build.js

# Start the server
node dist/server.js
```

Then open **http://localhost:3333** in your browser.

Or use the shortcut:
```bash
bash start.sh
```

## How it works

1. **Server** (`src/server.js`): Express + WebSocket server on port 3333. Loads character sprites, floor tiles, wall tiles, and furniture assets from the Pixel Agents VS Code extension's built files. Serves the React webview with an injected WebSocket adapter.

2. **Scanner** (`src/scanner.js`): Scans `~/.claude/projects/` every 5 seconds for JSONL files modified in the last 15 minutes. Parses Claude Code transcript events (tool_use, tool_result, turn_duration) and broadcasts agent activity to all connected browser clients.

3. **WS Adapter** (`public/ws-adapter.js`): Replaces VS Code's `acquireVsCodeApi()` with a WebSocket-based implementation. The React app thinks it's running inside VS Code but communicates over WebSocket instead.

## Features

- Detects Claude Code sessions from **any terminal** (Warp, iTerm, Hyper, etc.)
- Auto-discovers new sessions within 5 seconds
- Same pixel office, furniture editor, and character animations as the VS Code extension
- Layout persists in `~/.pixel-agents/layout.json` (shared with VS Code extension)
- Multiple browser tabs supported

## Asset path

The build script looks for Pixel Agents assets at:
```
~/.vscode/extensions/pablodelucca.pixel-agents-*/dist/
```

If you installed the extension in a custom location, update the paths in `build.js`.

## Credits

All pixel art assets, rendering engine, and character animations are from [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents). This project only adds the standalone server layer.

## License

Same as [Pixel Agents](https://github.com/pablodelucca/pixel-agents/blob/main/LICENSE).
