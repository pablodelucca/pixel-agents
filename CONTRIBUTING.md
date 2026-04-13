# Contributing to Pixel Agents

Thanks for your interest in contributing to Pixel Agents. All contributions are welcome: features, bug fixes, documentation improvements, refactors, and more.

This project is licensed under the [MIT License](LICENSE), so your contributions will be too. No CLA or DCO is required.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v22 recommended)
- [VS Code](https://code.visualstudio.com/) (v1.105.0 or later)
- Claude Code CLI if you want to work on the Claude provider path
- Codex CLI if you want to work on the Codex provider path outside mocked tests

### Setup

```bash
git clone https://github.com/pablodelucca/pixel-agents.git
cd pixel-agents
npm install
cd webview-ui && npm install && cd ..
cd server && npm install && cd ..
npm run build
```

Then press **F5** in VS Code to launch the Extension Development Host.

## Development Workflow

For development with live rebuilds, run:

```bash
npm run watch
```

This starts parallel watchers for the extension backend and TypeScript type-checking.

> **Note:** The webview (Vite) is not included in `watch`. After changing webview code, run `npm run build:webview` or the full `npm run build`.

## Running the Mocked Pixel Agent

You can run the mocked Pixel Agent web app from the CLI or from VS Code tasks.

### Option 1: CLI

```bash
cd webview-ui
npm run dev
```

Vite prints a local URL, typically `http://localhost:5173`.

### Option 2: VS Code Task

1. Run **Tasks: Run Task** from the command palette.
2. Select **Mocked Pixel Agent Dev Server**.
3. Open the local URL shown in the task output.

### Project Structure

| Directory        | Description                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `src/`           | Extension backend with VS Code integration                                               |
| `src/providers/` | Provider adapters, launch logic, provider preferences, and terminal matching             |
| `server/`        | Standalone HTTP server, provider event routing, Codex transport client, and Vitest suite |
| `webview-ui/`    | React + TypeScript frontend                                                              |
| `scripts/`       | Asset and debugging tooling, including provider smoke scripts                            |
| `assets/`        | Bundled sprites, catalog, and default layout                                             |

## Provider Architecture

The extension is provider-aware. Keep provider-specific launch and discovery logic inside `src/providers/`, and keep the office UI contract provider-neutral.

- `src/providers/claude/` owns the Claude launch flow, transcript discovery, and hook-based wiring.
- `src/providers/codex/` owns the Codex launch flow and `codex app-server` bootstrap.
- `server/src/providerEventRouter.ts` is the normalization layer that turns Claude/Codex lifecycle events into the shared webview messages already consumed by the UI.
- `server/src/providers/file/` contains Claude hook ingestion.
- `server/src/providers/codex/` contains the typed Codex app-server client and lifecycle mapper.

## Code Guidelines

### Constants

**No unused locals or parameters** (`noUnusedLocals` and `noUnusedParameters` are enabled). All magic numbers and strings are centralized:

- **Extension backend:** `src/constants.ts`
- **Webview:** `webview-ui/src/constants.ts`
- **CSS variables:** `webview-ui/src/index.css` `:root` block (`--pixel-*` properties)

### UI Styling

The project uses a pixel art aesthetic. All overlays should use:

- Sharp corners (`border-radius: 0`)
- Solid backgrounds and `2px solid` borders
- Hard offset shadows (`2px 2px 0px`, no blur) using `var(--pixel-shadow)`
- The FS Pixel Sans font loaded in `index.css`

These conventions are enforced by custom ESLint rules in `eslint-rules/pixel-agents-rules.mjs`.

## Unit & Integration Tests

```bash
# Run all tests (webview + server)
npm test

# Run only server tests
npm run test:server

# Run only webview tests
npm run test:webview
```

Server tests cover the HTTP server, provider registry/preferences, provider event routing, Codex transport mapping, hook installer, and the Claude hook script. They run after build because `claude-hook.test.ts` needs the compiled hook script at `dist/hooks/claude-hook.js`.

## End-to-End Tests

The `e2e/` directory contains Playwright tests that launch a real VS Code instance with the extension loaded in development mode.

### Running e2e tests locally

```bash
# Build the extension first
npm run build

# Run the full e2e suite
npm run e2e

# Step-by-step debug mode
npm run e2e:debug
```

On the first run, `@vscode/test-electron` downloads a stable VS Code release into `.vscode-test/`. Subsequent runs reuse the cache.

### Artifacts

All test artifacts are written to `test-results/e2e/`:

| Path                                   | Contents                                |
| -------------------------------------- | --------------------------------------- |
| `test-results/e2e/videos/<test-name>/` | `.webm` screen recording for every test |
| `playwright-report/e2e/`               | Playwright HTML report                  |
| `test-results/e2e/*.png`               | Final screenshots saved on failure      |

### Mock Claude

Tests never invoke the real `claude` CLI. Instead, `e2e/fixtures/mock-claude` is copied into an isolated `bin/` directory and prepended to `PATH` before VS Code starts.

The mock:

1. Parses `--session-id <uuid>` from its arguments.
2. Appends a line to `$HOME/.claude-mock/invocations.log`.
3. Creates `$HOME/.claude/projects/<project-hash>/<session-id>.jsonl` with a minimal init line.
4. Sleeps briefly so the terminal stays alive long enough for the extension to attach.

### Mock Codex

Tests never invoke the real `codex` CLI either. The Playwright launcher injects `e2e/fixtures/mock-codex` and `e2e/fixtures/mock-codex.cmd` into the isolated `bin/` directory and points the provider launch path at the mock app-server process.

The mock:

1. Logs invocations to `$HOME/.codex-mock/invocations.log`.
2. Emulates the minimum `codex app-server` JSON-RPC surface needed by the extension.
3. Supports targeted scenarios, including a `spawn-agent` flow that emits parent `spawnAgent` activity plus child sub-agent work for UI assertions.

Each test runs with an isolated `HOME` and `--user-data-dir`, so no test state leaks between runs or into your real VS Code profile.

### Codex transport smoke script

Use the smoke script when you want to validate `codex app-server` wiring outside Playwright:

```bash
npx tsx scripts/codex-app-server-smoke.ts --command codex --arg app-server --arg --listen --arg stdio:// --prompt "hello"
```

You can also point it at the mock fixture for deterministic local debugging.

## Packaging and Local Preview

If you want to install the current branch as a local preview build before opening a PR, follow the packaging guide in [docs/local-preview-release.md](docs/local-preview-release.md).

That guide covers:

- building a production-ready `.vsix`
- installing it locally in VS Code
- removing or replacing the local preview build
- the difference between a local preview, a PR, and a public release

## Submitting a Pull Request

1. Fork the repo and create a feature branch from `main`.
2. Make your changes.
3. Verify everything passes locally:

```bash
npm run lint
npm run build
npm test
```

For provider work, also run the focused regression matrix:

```bash
npm run test:server -- providerEventRouter.test.ts codexEventMapper.test.ts codexAppServerClient.test.ts providerPreferences.test.ts providerTerminalMatcher.test.ts providerRegistry.test.ts hookEventHandler.test.ts
npm run e2e -- --grep "switching to Codex and clicking \\+ Agent|provider switcher can spawn one Claude terminal and one Codex terminal|codex spawnAgent activity appears as a subagent in debug view"
```

4. Open a pull request against `main` with:

- A conventional commit title such as `feat: add zoom controls`
- A clear description of what changed and why
- How you tested the changes
- Screenshots or GIFs for any UI changes

> **Note:** PRs are merged using squash and merge. Your PR title becomes the final commit message, so keep it in conventional commit format.

## Reporting Bugs

[Open a bug report](https://github.com/pablodelucca/pixel-agents/issues/new?template=bug_report.yml).

## Feature Requests

[Open a feature request](https://github.com/pablodelucca/pixel-agents/issues/new?template=feature_request.yml) or join the conversation in [Discussions](https://github.com/pablodelucca/pixel-agents/discussions).

## Security Issues

Please report security vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold it.
