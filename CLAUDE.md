# PixelCity — Compressed Reference

Interactive pixel-art town of the Crystalline City. Player character (the Magistrate) walks around, talks to Construct NPCs, gets remembered. "Stardew Valley, not Spiderman."

## Architecture (v2 — Stardew Valley Re-Scope)

Forked from [pixel-agents](https://github.com/pablodelucca/pixel-agents) (MIT). Restructured from VS Code extension to Vite browser app with Express backend.

```
PixelCity/
├── webview-ui/              — Vite + React 19 + Canvas 2D (game client)
│   └── src/
│       ├── engine/          — Game loop, renderer, camera, input handler
│       ├── entities/        — Player, NPC, Building classes
│       ├── systems/         — Dialogue, Memory, Replay, Watcher
│       ├── data/            — Town tilemap JSON, sprite definitions
│       ├── ui/              — React overlay (dialogue box, HUD, minimap)
│       └── office/          — [LEGACY] Original pixel-agents engine (being refactored)
│           ├── engine/      — Game loop, rendering, character FSM (reuse)
│           ├── sprites/     — Sprite loading + caching (reuse)
│           ├── layout/      — Tile map + BFS pathfinding (reuse)
│           └── editor/      — Layout editor (defer)
├── server/                  — Express backend (filesystem reads + memory writes)
│   └── src/
│       ├── watchers/        — JSONL, EAM, Notes filesystem watchers
│       ├── api/             — REST endpoints for city data
│       └── memory/          — Town memory read/write (JSON per construct)
├── data/
│   ├── town_memory/         — Interaction logs (JSON per construct, persistent)
│   └── town_tilemap/        — Hand-crafted town layout (JSON)
├── src/                     — [LEGACY] VS Code extension backend (not used in browser mode)
└── scripts/                 — Asset processing pipeline (from pixel-agents)
```

## Core Concepts

**Player Character**: Arrow key / WASD movement on tile grid. Camera follows. Collision with buildings/water/fences. Walk animation (4 frames × 4 directions).

**NPC Interaction**: Walk within 2 tiles of Construct → interaction prompt. Press E → dialogue box (bottom-of-screen RPG style). Template-based speech from MOUNT_HEADER.md. Zero LLM cost.

**Town Memory**: `data/town_memory/{construct}.json` — `last_interaction_date`, `interaction_count`, `last_topic`, `mood`. Constructs greet based on visit history. Lightweight interaction log, NOT full EAM.

**Town Layout**: ~40×30 tile grid, hand-crafted JSON tilemap, ~15-20 buildings. Stardew Valley scale — intimate, walkable in 30 seconds.

**Replay Layer**: Background ambiance. EAM entries → construct walks to building → works → emerges. Does NOT interrupt player interaction.

**Live Layer**: JSONL watcher for Mark95 activity. Town Hall glows when building. Lens spawn → NPC appears at Town Hall.

## What We Reuse from pixel-agents

- Canvas 2D + requestAnimationFrame game loop (`office/engine/gameLoop.ts`)
- BFS pathfinding on tile grid (`office/layout/tileMap.ts`)
- Sprite rendering + caching (`office/sprites/`)
- Character FSM (idle/walk states from `office/engine/characters.ts`)
- JSONL transcript parsing (`src/transcriptParser.ts`, `src/fileWatcher.ts`)
- Pixel font (FS Pixel Sans)
- CSS custom properties (--pixel-* variables)

## What's New

- **Player entity**: Direct input movement (not BFS), camera follow
- **NPC dialogue system**: Proximity trigger, dialogue box UI, template speech
- **Town memory**: JSON-based interaction logging and recall
- **Town tilemap**: Hand-crafted layout replacing procedural office grid
- **Express server**: Backend for filesystem reads (replaces VS Code extension host)
- **WebSocket**: Server → client events for live watcher updates

## Priority Constructs (Phase 2 NPCs)

Athena, Cadence, LoreForged, Glasswright, Lena, Keeper, Venture, Swiftquill, Pyrosage, Echolumen

## Build & Dev

```sh
# Client (Vite dev server)
cd webview-ui && npm install && npm run dev

# Server (Express backend) — TBD, Phase 2+
cd server && npm install && npm run dev

# Full build
npm run build
```

## TypeScript Constraints (inherited)

- No `enum` (`erasableSyntaxOnly`) — use `as const` objects
- `import type` required for type-only imports
- `noUnusedLocals` / `noUnusedParameters`

## Constants

All magic numbers centralized:
- **Webview**: `webview-ui/src/constants.ts` — grid sizes, animation speeds, rendering params
- **CSS**: `webview-ui/src/index.css` `:root` — `--pixel-*` custom properties

## Key Decisions

- **Platform**: Vite browser app first, VS Code extension port deferred
- **Dialogue**: Template-based, zero LLM cost. Lines from MOUNT_HEADER.md
- **Memory**: Lightweight JSON per construct in `data/town_memory/`
- **Town scale**: ~15-20 buildings, hand-crafted tilemap, NOT procedural
- **Tileset**: TBD — itch.io asset pack, OpenGameArt, or AI-generated

## Reference

- Full spec: `C:\CrystallineCity\claudecode\ClaudeFiles\Magistrate\PIXEL_CITY_PROJECT_SPEC.md`
- AFM: `C:\CrystallineCity\claudecode\ClaudeFiles\Magistrate\AFM\EPIC-PIXELCITY-25.md`
- Construct registry: `C:\CrystallineCity\claudecode\CrystallineCity-Dev\CityData\registry\ConstructAtlas_v3.0.json`
- MOUNT_HEADER locations: `C:\CrystallineCity\claudecode\CrystallineCity-Dev\Constructs\{Name}\MOUNT_HEADER.md`
