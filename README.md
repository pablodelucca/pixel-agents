# Pixel Agents

A VS Code extension that turns your coding agents and terminals into animated pixel art characters in a virtual office.

Every terminal you open — whether it's Claude Code, Opencode, or a plain VS Code shell — can spawn a character that walks around, sits at desks, and visually shows what it's doing in real time.

This is a fork of the [Pixel Agents extension](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents) by [pablodelucca](https://github.com/pablodelucca/pixel-agents), with added support for multiple agent types beyond Claude Code.

![Pixel Agents screenshot](webview-ui/public/Screenshot.jpg)

## Features

- **Multi-agent support** — connect Claude Code, Opencode, or any VS Code terminal as an animated character
- **Live activity tracking** — characters animate based on real activity (writing, reading, running commands)
- **VS Code Terminal tracking** — any shell command (`dir`, `npm install`, `ping`, etc.) makes the character animate via VS Code's shell integration API
- **Office layout editor** — design your office with floors, walls, and furniture using a built-in editor
- **Speech bubbles** — visual indicators when an agent is waiting for input or needs permission
- **Sound notifications** — optional chime when an agent finishes its turn
- **Sub-agent visualization** — Task tool sub-agents spawn as separate characters linked to their parent
- **Persistent layouts** — your office design is saved and shared across VS Code windows
- **Diverse characters** — 6 diverse characters based on the amazing work of [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack)

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Pixel Agents characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## Supported Agent Types

| Agent Type | How It Works | Activity Detection |
|---|---|---|
| **Claude Code** | Launches `claude` CLI in a terminal | Watches JSONL transcript files — shows specific tool status (Reading, Writing, Running, etc.) |
| **Opencode** | Launches `opencode` CLI in a terminal | Watches JSONL transcript files — similar to Claude Code |
| **VS Code Terminal** | Creates a new shell or adopts an existing terminal | Uses VS Code shell integration — detects command start/end, shows the command being run |

## Requirements

- VS Code 1.107.0 or later
- **For Claude Code agents:** [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed
- **For Opencode agents:** [Opencode](https://github.com/nichochar/opencode) installed
- **For VS Code Terminal agents:** No extra requirements — works with any terminal

## Getting Started

### Install from source

```bash
git clone https://github.com/Drepheus/pixel-agents.git
cd pixel-agents
npm install
cd webview-ui && npm install && cd ..
npm run build
```

Then press **F5** in VS Code to launch the Extension Development Host.

### Usage

1. Open the **Pixel Agents** panel (it appears in the bottom panel area alongside your terminal)
2. Click **+ Agent** and choose an agent type:
   - **Claude Code** — spawns a Claude Code CLI terminal
   - **Opencode** — spawns an Opencode CLI terminal
   - **VS Code Terminal** — spawns a new shell (or use **Adopt Terminal** to connect an existing one)
3. Run commands or start coding — watch the character react in real time
4. Click a character to select it, then click a chair to assign it a seat
5. Click **Layout** to open the office editor and customize your space

### VS Code Terminal Agents

VS Code Terminal agents work with any shell. They detect commands using VS Code's built-in shell integration:

- When you run a command (e.g., `dir`, `npm install`, `git status`), the character walks to its desk and starts typing
- When the command finishes, the character goes back to idle wandering
- The status overlay shows the actual command being run (e.g., "Running: npm install")

**Note:** Shell integration must be active in the terminal (it's enabled by default in modern VS Code).

## Layout Editor

The built-in editor lets you design your office:

- **Floor** — Full HSB color control
- **Walls** — Auto-tiling walls with color customization
- **Tools** — Select, paint, erase, place, eyedropper, pick
- **Undo/Redo** — 50 levels with Ctrl+Z / Ctrl+Y
- **Export/Import** — Share layouts as JSON files via the Settings modal

The grid is expandable up to 64×64 tiles. Click the ghost border outside the current grid to grow it.

### Office Assets

The office tileset used in this project is **[Office Interior Tileset (16x16)](https://donarg.itch.io/officetileset)** by **Donarg**, available on itch.io for **$2 USD**.

The tileset is not included in this repository due to its license. To use the full furniture catalog, purchase the tileset and run:

```bash
npm run import-tileset
```

The extension works without the tileset — you get default characters and basic layout, but the full furniture catalog requires the imported assets.

## How It Works

- **Claude Code / Opencode:** Watches JSONL transcript files to track tool usage. When an agent reads a file, writes code, or runs a command, the character animates accordingly.
- **VS Code Terminal:** Hooks into `onDidStartTerminalShellExecution` and `onDidEndTerminalShellExecution` to detect when commands are running.

The webview runs a lightweight game loop with canvas rendering, BFS pathfinding, and a character state machine (idle → walk → type/read). Everything is pixel-perfect at integer zoom levels.

## Tech Stack

- **Extension**: TypeScript, VS Code Webview API, esbuild
- **Webview**: React 19, TypeScript, Vite, Canvas 2D

## Known Limitations

- **Shell integration required for VS Code Terminal agents** — if shell integration isn't active in a terminal, command detection won't work
- **Agent-terminal sync** — connecting agents to terminal instances can desync when terminals are rapidly opened/closed or restored across sessions
- **Heuristic-based status detection** — Claude Code/Opencode status detection uses timers and heuristics that can occasionally misfire
- **Windows-focused testing** — primarily tested on Windows 11; may work on macOS/Linux but could have issues

## Upstream

This is a fork of [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents). The multi-agent support (Opencode, VS Code Terminal, terminal activity tracking) was added in this fork.

## License

This project is licensed under the [MIT License](LICENSE).
