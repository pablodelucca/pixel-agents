# Changelog

## v1.3.0-dev.1

### Development Preview

- **Provider-aware launch flow** - Added a toolbar provider switcher, persisted provider preferences, and provider-specific terminal naming so Claude Code and Codex can launch from the same `+ Agent` flow.
- **Codex transport integration** - Added the typed `codex app-server` client, lifecycle mapper, and shared event routing so Codex emits the same office states as Claude.
- **Sub-agent parity across providers** - Codex `spawnAgent` work now appears in the office/debug view as linked sub-agent activity, matching the existing Claude sub-agent model.
- **Regression tooling** - Added mock Codex fixtures, a transport smoke script, and end-to-end coverage for provider switching plus Codex `spawnAgent` visualization.

## v1.2.0

### Features

- **External asset packs** ([#169](https://github.com/pablodelucca/pixel-agents/pull/169)) - Load furniture assets from user-defined directories outside the extension, enabling third-party asset packs alongside built-in furniture. Add/remove directories via Settings modal with live palette refresh.
- **Bypass permissions mode** ([#170](https://github.com/pablodelucca/pixel-agents/pull/170)) - Right-click the "+ Agent" button to launch with `--dangerously-skip-permissions`, skipping all tool-call approval prompts.
- **Improved seating, sub-agent spawning, and background agents** ([#180](https://github.com/pablodelucca/pixel-agents/pull/180)) - Agents prefer seats facing electronics (PCs, monitors). Sub-agents spawn on the closest walkable tile to their parent instead of claiming seats. Background agents stay alive until their queue-operation completes.
- **Agent connection diagnostics and JSONL parser resilience** ([#183](https://github.com/pablodelucca/pixel-agents/pull/183)) - Debug View shows agent connection state with diagnostic info. JSONL parser handles malformed/partial records gracefully. Simplified file watching to single poll for reliability.
- **Browser preview mode** ([#143](https://github.com/pablodelucca/pixel-agents/pull/143)) - Preview the Pixel Agents webview in a browser for development and review.
- **Always show overlay setting** - Option to keep agent overlay labels visible at all times, with reduced opacity for non-focused agents.

### Fixes

- **Agents not appearing on Linux Mint and macOS without a folder open** ([#70](https://github.com/pablodelucca/pixel-agents/pull/70)) - Falls back to `os.homedir()` when no workspace folder is open, matching Claude Code's own behavior.

### Testing

- **Playwright e2e tests** ([#161](https://github.com/pablodelucca/pixel-agents/pull/161)) - End-to-end test infrastructure using Playwright's Electron API with a mock Claude CLI, validating agent spawn flow in a real VS Code instance.

### Maintenance

- Add feature request template and update community docs ([#164](https://github.com/pablodelucca/pixel-agents/pull/164))
- Bump Vite 8.0, ESLint 10, and various dependency updates
- CI improvements: skip PR title check for Dependabot, restrict badge updates to main repo ([#181](https://github.com/pablodelucca/pixel-agents/pull/181))

### Contributors

Thank you to the contributors who made this release possible:

- [@marctebo](https://github.com/marctebo) - External asset packs support
- [@dankadr](https://github.com/dankadr) - Bypass permissions mode
- [@d4rkd0s](https://github.com/d4rkd0s) - Linux/macOS fix for no-folder workspaces
- [@daniel-dallimore](https://github.com/daniel-dallimore) - Always show overlay setting
- [@NNTin](https://github.com/NNTin) - Playwright e2e tests, browser preview mode
- [@florintimbuc](https://github.com/florintimbuc) - Agent diagnostics, JSONL resilience, CI improvements, code review

## v1.1.1

### Fixes

- **Fix Open VSX publishing** - Created namespace on Open VSX and added `skipDuplicate` to publish workflow for idempotent releases.

## v1.1.0

### Features

- **Migrate to open-source assets with modular manifest-based loading** ([#117](https://github.com/pablodelucca/pixel-agents/pull/117)) - Replaces bundled proprietary tileset with open-source assets loaded via a manifest system, enabling community contributions and modding.
- **Recognize 'Agent' tool name for sub-agent visualization** ([#76](https://github.com/pablodelucca/pixel-agents/pull/76)) - Claude Code renamed the sub-agent tool from 'Task' to 'Agent'; sub-agent characters now spawn correctly with current Claude Code versions.
- **Dual-publish workflow for VS Code Marketplace + Open VSX** ([#44](https://github.com/pablodelucca/pixel-agents/pull/44)) - Automates extension releases to both VS Code Marketplace and Open VSX via GitHub Actions.

### Maintenance

- **Add linting, formatting, and repo infrastructure** ([#82](https://github.com/pablodelucca/pixel-agents/pull/82)) - ESLint, Prettier, Husky pre-commit hooks, and lint-staged for consistent code quality.
- **Add CI workflow, Dependabot, and ESLint contributor rules** ([#116](https://github.com/pablodelucca/pixel-agents/pull/116)) - Continuous integration, automated dependency updates, and shared linting configuration.
- **Lower VS Code engine requirement to ^1.105.0** - Broadens compatibility with older VS Code versions and forks.

### Contributors

Thank you to the contributors who made this release possible:

- [@drewf](https://github.com/drewf) - Agent tool recognition for sub-agent visualization
- [@Matthew-Smith](https://github.com/Matthew-Smith) - Open VSX publishing workflow
- [@florintimbuc](https://github.com/florintimbuc) - Project coordination, CI workflow, Dependabot, linting infrastructure, publish workflow hardening, code review

## v1.0.2

### Bug Fixes

- **macOS path sanitization and file watching reliability** ([#45](https://github.com/pablodelucca/pixel-agents/pull/45)) - Comprehensive path sanitization for workspace paths with underscores, Unicode/CJK chars, dots, spaces, and special characters. Added `fs.watchFile()` as reliable secondary watcher on macOS. Fixes [#32](https://github.com/pablodelucca/pixel-agents/issues/32), [#39](https://github.com/pablodelucca/pixel-agents/issues/39), [#40](https://github.com/pablodelucca/pixel-agents/issues/40).

### Features

- **Workspace folder picker for multi-root workspaces** ([#12](https://github.com/pablodelucca/pixel-agents/pull/12)) - Clicking "+ Agent" in a multi-root workspace now shows a picker to choose which folder to open Claude Code in.

### Maintenance

- **Lower VS Code engine requirement to ^1.107.0** ([#13](https://github.com/pablodelucca/pixel-agents/pull/13)) - Broadens compatibility with older VS Code versions and forks without code changes.

### Contributors

Thank you to the contributors who made this release possible:

- [@johnnnzhub](https://github.com/johnnnzhub) - macOS path sanitization and file watching fixes
- [@pghoya2956](https://github.com/pghoya2956) - multi-root workspace folder picker, VS Code engine compatibility

## v1.0.1

Initial public release.
