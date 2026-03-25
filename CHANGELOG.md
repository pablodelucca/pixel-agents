# Changelog

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
