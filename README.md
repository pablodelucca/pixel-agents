<h1 align="center">
    <a href="https://github.com/pablodelucca/pixel-agents/discussions">
        <img src="webview-ui/public/banner.png" alt="Pixel Agents">
    </a>
</h1>

<h2 align="center" style="padding-bottom: 20px;">
  The game interface where AI agents build real things
</h2>

<div align="center" style="margin-top: 25px;">

[![version](https://img.shields.io/endpoint?url=https%3A%2F%2Fgist.githubusercontent.com%2Fpablodelucca%2F3cd28398fa4a2c0a636e1d51d41aee39%2Fraw%2Fversion.json)](https://github.com/pablodelucca/pixel-agents/releases)
[![marketplaces](https://img.shields.io/endpoint?url=https%3A%2F%2Fgist.githubusercontent.com%2Fpablodelucca%2F3cd28398fa4a2c0a636e1d51d41aee39%2Fraw%2Finstalls.json)](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents)
[![stars](https://img.shields.io/github/stars/pablodelucca/pixel-agents?logo=github&color=0183ff&style=flat)](https://github.com/pablodelucca/pixel-agents/stargazers)
[![license](https://img.shields.io/github/license/pablodelucca/pixel-agents?color=0183ff&style=flat)](https://github.com/pablodelucca/pixel-agents/blob/main/LICENSE)
[![good first issues](https://img.shields.io/github/issues/pablodelucca/pixel-agents/good%20first%20issue?color=7057ff&label=good%20first%20issues)](https://github.com/pablodelucca/pixel-agents/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22)

</div>

<div align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents">VS Code Marketplace</a> • <a href="https://github.com/pablodelucca/pixel-agents/discussions">Discussions</a> • <a href="https://github.com/pablodelucca/pixel-agents/issues">Issues</a> • <a href="CONTRIBUTING.md">Contributing</a> • <a href="CHANGELOG.md">Changelog</a>
</div>

<br/>

Pixel Agents turns multi-agent AI systems into something you can actually see and manage. Each agent becomes a character in a pixel art office. They walk around, sit at their desk, and visually reflect what they are doing: typing when writing code, reading when searching files, waiting when they need your attention.

Today the VS Code extension supports a mature Claude Code flow and a Codex preview flow behind the same provider-aware UI. The long-term direction is still agent-agnostic and platform-agnostic.

This is the source code for the free Pixel Agents extension for VS Code. Install it from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=pablodelucca.pixel-agents) or [Open VSX](https://open-vsx.org/extension/pablodelucca/pixel-agents).

![Pixel Agents screenshot](webview-ui/public/Screenshot.jpg)

## Features

- **One agent, one character** - every Claude Code or Codex terminal gets its own animated character.
- **Live activity tracking** - characters animate based on what the agent is actually doing.
- **Office layout editor** - design your office with floors, walls, and furniture using a built-in editor.
- **Speech bubbles** - visual indicators when an agent is waiting for input or needs permission.
- **Sound notifications** - optional chime when an agent finishes its turn.
- **Sub-agent visualization** - Claude Agent/Task workers and Codex `spawnAgent` work show up as linked characters.
- **Persistent layouts** - your office design is saved and shared across VS Code windows.
- **External asset directories** - load custom or third-party furniture packs from any folder on your machine.
- **Diverse characters** - 6 diverse characters based on the work of [JIK-A-4, Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack).

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Pixel Agents characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## Requirements

- VS Code 1.105.0 or later
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured if you want the Claude provider
- Codex CLI installed and authenticated if you want the Codex preview provider
- Platform support: Windows, Linux, and macOS

## Getting Started

If you just want to use Pixel Agents, install the extension. If you want to develop or contribute:

### Install from source

```bash
git clone https://github.com/pablodelucca/pixel-agents.git
cd pixel-agents
npm install
cd webview-ui && npm install && cd ..
cd server && npm install && cd ..
npm run build
```

Then press **F5** in VS Code to launch the Extension Development Host.

### Usage

1. Open the **Pixel Agents** panel in the bottom panel area.
2. Use the provider switcher next to **+ Agent** to choose **Claude Code** or **Codex**.
3. Click **+ Agent** to spawn a new terminal and its character.
4. Right-click **+ Agent** to launch with `--dangerously-skip-permissions` where the selected provider supports it.
5. Start coding and watch the character react in real time.
6. Click a character to select it, then click a seat to reassign it.
7. Click **Layout** to open the office editor and customize your space.

## Layout Editor

The built-in editor lets you design your office:

- **Floor** - full HSB color control
- **Walls** - auto-tiling walls with color customization
- **Tools** - select, paint, erase, place, eyedropper, pick
- **Undo/Redo** - 50 levels with Ctrl+Z / Ctrl+Y
- **Export/Import** - share layouts as JSON files via the Settings modal

The grid is expandable up to 64x64 tiles. Click the ghost border outside the current grid to grow it.

### Office Assets

All office assets (furniture, floors, walls) are open source and included in this repository under `webview-ui/public/assets/`.

Each furniture item lives in its own folder under `assets/furniture/` with a `manifest.json` that declares sprites, rotation groups, state groups, and animation frames. Floor tiles are individual PNGs in `assets/floors/`, and wall tile sets are in `assets/walls/`.

To add a new furniture item, create a folder in `webview-ui/public/assets/furniture/` with your PNG sprite files and a `manifest.json`, then rebuild. The asset manager at `scripts/asset-manager.html` provides a visual editor for creating and editing manifests.

To use furniture from an external directory, open Settings and choose **Add Asset Directory**. See [docs/external-assets.md](docs/external-assets.md) for the manifest format and third-party asset workflow.

## How It Works

Pixel Agents normalizes provider-specific runtime signals into one shared office model.

- Claude Code is tracked through JSONL transcripts plus hook events.
- Codex is tracked through structured `codex app-server` notifications handled by the local Pixel Agents server.
- Both paths end up in the same canonical lifecycle messages for tool activity, waiting states, turn completion, and sub-agent work.

The webview runs a lightweight game loop with canvas rendering, BFS pathfinding, and a character state machine.

## Tech Stack

- **Extension**: TypeScript, VS Code Webview API, esbuild
- **Server**: TypeScript, Vitest, provider event normalization
- **Webview**: React 19, TypeScript, Vite, Canvas 2D

## Known Limitations

- **Agent-terminal sync** - terminal matching is still not perfectly robust, especially during rapid open/close or restore flows.
- **Claude waiting heuristics** - Claude JSONL transcripts still require heuristic detection for some waiting and turn-complete transitions.
- **Codex preview scope** - Codex launch, lifecycle mapping, and `spawnAgent` visualization are supported, but external-session discovery/attach is still deferred.
- **Linux/macOS tip** - if you launch VS Code without a folder open, agents start in your home directory and Claude sessions are tracked under `~/.claude/projects/`.

## Troubleshooting

If an agent appears stuck or does not spawn:

1. **Debug View** - in the Pixel Agents panel, open **Settings** and enable **Debug View**. This shows connection diagnostics per agent, including transcript or provider status and recent tool activity.
2. **Debug Console** - when running from source, open **View > Debug Console** and search for `[Pixel Agents]` to inspect provider startup, routing, and file-watcher logs.

## Where This Is Going

The long-term vision is an interface where managing AI agents feels like playing the Sims, but the results are real things built.

- **Agents as characters** you can see, assign, monitor, and redirect.
- **Desks as directories** so an agent can be assigned to a project or working directory.
- **An office as a project** with a Kanban board where idle agents can pick up tasks.
- **Deep inspection** for model, branch, prompt, history, and interruption controls.
- **Token health bars** for rate limits and context windows.
- **Fully customizable** themes, sprites, and office assets.

For this to work, the architecture has to stay modular:

- **Platform-agnostic**: VS Code extension today, other hosts later.
- **Agent-agnostic**: Claude Code and Codex today, more providers later.
- **Theme-agnostic**: community-created assets, skins, and themes.

## Community & Contributing

Use **[Issues](https://github.com/pablodelucca/pixel-agents/issues)** to report bugs or request features. Join **[Discussions](https://github.com/pablodelucca/pixel-agents/discussions)** for questions and conversations.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, provider architecture, mock CLI fixtures, and the regression matrix expected before merging.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Supporting the Project

If you find Pixel Agents useful, consider supporting its development:

<a href="https://github.com/sponsors/pablodelucca">
  <img src="https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?logo=github" alt="GitHub Sponsors">
</a>
<a href="https://ko-fi.com/pablodelucca">
  <img src="https://img.shields.io/badge/Support-Ko--fi-ff5e5b?logo=ko-fi" alt="Ko-fi">
</a>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=pablodelucca/pixel-agents&type=Date)](https://www.star-history.com/?repos=pablodelucca%2Fpixel-agents&type=date&legend=bottom-right)

## License

This project is licensed under the [MIT License](LICENSE).
