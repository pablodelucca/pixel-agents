# Changelog

## v0.1.0

Initial `oh-my-pixel-agents` fork release, cut from the current `codex` branch baseline and focused on making Pixel Agents feel first-class with Codex CLI as well as Claude Code.

### Features

- **Codex runtime support end-to-end** — adds a dedicated Codex adapter, Codex-aware session launch flow, JSONL transcript parsing, recursive transcript discovery, and workspace-safe matching so Codex sessions are tracked reliably.
- **Inspector and timeline upgrades** — introduces a pinned agent inspector plus richer timeline/debug rails so tool activity, sub-agent branches, waiting states, and confidence signals are easier to follow in the office view.
- **Configurable backend selection** — adds the `pixel-agents.agentType` setting so you can explicitly switch between Codex and Claude backends.

### Fixes

- **Codex session stability improvements** — restores tool metadata after permission clears, preserves agent context across turn clears, and normalizes selection/state handling so inspection remains meaningful during long sessions.
- **Launch and watcher hardening** — improves Codex CLI launch behavior plus JSONL file watching/cwd checks to reduce missed sessions and cross-workspace interference.
- **Inspector readability polish** — tightens overlay styling, visibility colors, and waiting indicators for a clearer, more consistent UI.

### Docs & Maintenance

- **Bilingual onboarding refresh** — updates the English and Korean READMEs with Codex-ready setup guidance and practical verification steps.
- **Runtime/tooling alignment** — pins the repository Node version to the runtime the current toolchain expects and updates repo metadata for this fork's GitHub release flow.

## v1.1.1

### Fixes

- **Fix Open VSX publishing** — Created namespace on Open VSX and added `skipDuplicate` to publish workflow for idempotent releases.

## v1.1.0

### Features

- **Migrate to open-source assets with modular manifest-based loading** ([#117](https://github.com/pablodelucca/pixel-agents/pull/117)) — Replaces bundled proprietary tileset with open-source assets loaded via a manifest system, enabling community contributions and modding.
- **Recognize 'Agent' tool name for sub-agent visualization** ([#76](https://github.com/pablodelucca/pixel-agents/pull/76)) — Claude Code renamed the sub-agent tool from 'Task' to 'Agent'; sub-agent characters now spawn correctly with current Claude Code versions.
- **Dual-publish workflow for VS Code Marketplace + Open VSX** ([#44](https://github.com/pablodelucca/pixel-agents/pull/44)) — Automates extension releases to both VS Code Marketplace and Open VSX via GitHub Actions.

### Maintenance

- **Add linting, formatting, and repo infrastructure** ([#82](https://github.com/pablodelucca/pixel-agents/pull/82)) — ESLint, Prettier, Husky pre-commit hooks, and lint-staged for consistent code quality.
- **Add CI workflow, Dependabot, and ESLint contributor rules** ([#116](https://github.com/pablodelucca/pixel-agents/pull/116)) — Continuous integration, automated dependency updates, and shared linting configuration.
- **Lower VS Code engine requirement to ^1.105.0** — Broadens compatibility with older VS Code versions and forks (Cursor, Antigravity, Windsurf, VSCodium, Kiro, TRAE, Positron, etc.).

### Contributors

Thank you to the contributors who made this release possible:

- [@drewf](https://github.com/drewf) — Agent tool recognition for sub-agent visualization
- [@Matthew-Smith](https://github.com/Matthew-Smith) — Open VSX publishing workflow
- [@florintimbuc](https://github.com/florintimbuc) — Project coordination, CI workflow, Dependabot, linting infrastructure, publish workflow hardening, code review

## v1.0.2

### Bug Fixes

- **macOS path sanitization and file watching reliability** ([#45](https://github.com/pablodelucca/pixel-agents/pull/45)) — Comprehensive path sanitization for workspace paths with underscores, Unicode/CJK chars, dots, spaces, and special characters. Added `fs.watchFile()` as reliable secondary watcher on macOS. Fixes [#32](https://github.com/pablodelucca/pixel-agents/issues/32), [#39](https://github.com/pablodelucca/pixel-agents/issues/39), [#40](https://github.com/pablodelucca/pixel-agents/issues/40).

### Features

- **Workspace folder picker for multi-root workspaces** ([#12](https://github.com/pablodelucca/pixel-agents/pull/12)) — Clicking "+ Agent" in a multi-root workspace now shows a picker to choose which folder to open Claude Code in.

### Maintenance

- **Lower VS Code engine requirement to ^1.107.0** ([#13](https://github.com/pablodelucca/pixel-agents/pull/13)) — Broadens compatibility with older VS Code versions and forks (Cursor, etc.) without code changes.

### Contributors

Thank you to the contributors who made this release possible:

- [@johnnnzhub](https://github.com/johnnnzhub) — macOS path sanitization and file watching fixes
- [@pghoya2956](https://github.com/pghoya2956) — multi-root workspace folder picker, VS Code engine compatibility

## v1.0.1

Initial public release.
