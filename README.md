# Pixel Office

A multiplayer pixel art office where your AI coding agents come to life as animated characters. Run the server, open it in a browser, and connect your Claude Code sessions — each one becomes a character that walks around, sits at desks, and visually reflects what the agent is doing.

Multiple people can join the same office from different machines, making it a shared space where your whole team's agents are visible at once.

![Pixel Agents screenshot](webview-ui/public/Screenshot.jpg)

## Features

- **Live activity tracking** — characters animate based on what each agent is doing (writing code, reading files, running commands)
- **Multiplayer** — anyone can join your office with `bun cli/join.ts ws://host:3000/ws --name Name`
- **Office layout editor** — design your space with floors, walls, and furniture using the built-in editor
- **Speech bubbles** — visual indicators when an agent is waiting for input or needs permission
- **Sound notifications** — optional chime when an agent finishes its turn
- **Sub-agent visualization** — Task tool sub-agents spawn as separate characters linked to their parent
- **Persistent layouts** — your office design is saved across sessions
- **Diverse characters** — 6 diverse character skins with automatic palette assignment. Based on [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack).

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Pixel Office characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## Requirements

- [Bun](https://bun.sh/) runtime
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured
- Node.js 18+ (for the frontend build)

## Getting Started

```bash
git clone https://github.com/neverov/pixel-agents.git
cd pixel-agents
npm run install:all
npm run build
```

### Start the server

```bash
npm start
```

This starts the Pixel Office server at **http://localhost:3000**. Open it in your browser to see the office.

The server is a pure relay — it doesn't run any agents itself. It serves the UI, manages layout/settings, and relays agent events between peers and browsers.

### Connect your agents

In a separate terminal, join the office with your local Claude Code sessions:

```bash
bun cli/join.ts ws://localhost:3000/ws --name Andrew
```

This scans your `~/.claude/projects/` for active Claude sessions and sends their activity to the server. Each active session appears as a character in the office.

### Multiplayer

Share the server URL and others can join from their machines:

```bash
bun cli/join.ts ws://your-host:3000/ws --name Alice
```

Their Claude sessions appear in the same office with labels like "Alice: project-name". Use [ngrok](https://ngrok.com/) or similar for remote access:

```bash
ngrok http 3000
# Then others join with:
bun cli/join.ts wss://your-ngrok-url.ngrok-free.app/ws --name Alice
```

### Development

```bash
npm run dev    # Runs bun --watch server + vite dev server with hot reload
```

## Layout Editor

The built-in editor lets you design your office:

- **Floor** — 7 patterns with full HSB color control
- **Walls** — Auto-tiling walls with color customization
- **Furniture** — Place, rotate (R), toggle state (T), drag to move, colorize
- **Tools** — Select, paint, erase, place, eyedropper, pick
- **Undo/Redo** — 50 levels with Ctrl+Z / Ctrl+Y
- **Export/Import** — Share layouts as JSON files via the Settings modal

The grid is expandable up to 64x64 tiles. Click the ghost border outside the current grid to grow it.

### Office Assets

The office tileset is **[Office Interior Tileset (16x16)](https://donarg.itch.io/officetileset)** by **Donarg**, available on itch.io for **$2 USD**.

The tileset is not included in this repository due to its license. To use the full furniture catalog, purchase the tileset and run:

```bash
npm run import-tileset
```

The app works without it — you get default characters and a basic layout, but the full furniture catalog requires the imported assets.

## How It Works

The join CLI watches Claude Code's JSONL transcript files (`~/.claude/projects/`) to track what each agent is doing. When an agent uses a tool, the CLI sends the event over WebSocket to the server, which broadcasts it to all connected browsers. The browser renders animated characters with a canvas game loop, BFS pathfinding, and a character state machine (idle -> walk -> type/read).

No modifications to Claude Code are needed — it's purely observational.

## Architecture

```
server/           Node.js backend (Express, WS)
  index.ts        Entry point — HTTP server, WS relay, layout/settings
  peerManager.ts  Peer protocol — maps remote agent events to broadcasts
  join.ts         CLI entry point for connecting local sessions
  wsManager.ts    WebSocket server
  routes.ts       REST API (layout, settings)
  ...             File watching, transcript parsing, timers

webview-ui/       React + Vite frontend
  src/
    serverApi.ts  WS + REST client
    assetLoader.ts  Browser-side PNG -> sprite loading
    office/       Game engine (canvas, characters, editor)
```

## Tech Stack

- **Server**: TypeScript, Express, ws, node-pty, Bun
- **Frontend**: React 19, TypeScript, Vite, Canvas 2D
- **Communication**: WebSocket (real-time events) + REST (layout/settings)

## Known Limitations

- **Heuristic-based status detection** — Claude Code's JSONL format doesn't provide clear signals for agent idle/waiting states. Detection uses heuristics (idle timers, turn-duration events) and occasionally misfires.
- **Session detection latency** — the join CLI polls for new sessions every 5 seconds, so there's a brief delay before new Claude sessions appear.

## Contributing

Based on [Pixel Agents](https://github.com/pablodelucca/pixel-agents) by Pablo De Lucca.

See [CONTRIBUTORS.md](CONTRIBUTORS.md) for instructions. Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## License

This project is licensed under the [MIT License](LICENSE).
