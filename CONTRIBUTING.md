# Contributing to Pixel Agents

Thanks for your interest in contributing to Pixel Agents! All contributions are welcome — features, bug fixes, documentation improvements, refactors, and more.

This project is licensed under the [MIT License](LICENSE), so your contributions will be too. No CLA or DCO is required.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v22 recommended)
- [VS Code](https://code.visualstudio.com/) (v1.105.0 or later)

### Setup

```bash
git clone https://github.com/pablodelucca/pixel-agents.git
cd pixel-agents
npm install
cd webview-ui && npm install && cd ..
npm run build
```

Then press **F5** in VS Code to launch the Extension Development Host.

## Development Workflow

For development with live rebuilds, run:

```bash
npm run watch
```

This starts parallel watchers for both the extension backend (esbuild) and TypeScript type-checking.

> **Note:** The webview (Vite) is not included in `watch` — after changing webview code, run `npm run build:webview` or the full `npm run build`.

## Running the Mocked Pixel Agent

You can run the mocked Pixel Agent web app either from the CLI or from VS Code tasks.

### Option 1: CLI

From the repository root:

```bash
cd webview-ui
npm run dev
```

Vite will print a local URL (typically `http://localhost:5173`) where the mocked app is available.

### Option 2: VS Code Run Task

1. Open the command palette and run **Tasks: Run Task**.
2. Select **Mocked Pixel Agent Dev Server**.
3. Open the local URL shown in the task terminal output (typically `http://localhost:5173`).

### Project Structure

| Directory | Description |
|---|---|
| `src/` | Extension backend — Node.js, VS Code API |
| `webview-ui/` | React + TypeScript frontend (separate Vite project) |
| `scripts/` | Asset extraction and generation tooling |
| `assets/` | Bundled sprites, catalog, and default layout |

## Code Guidelines

### Constants

**No unused locals or parameters** (`noUnusedLocals` and `noUnusedParameters` are enabled). All magic numbers and strings are centralized — don't add inline constants to source files:

- **Extension backend:** `src/constants.ts`
- **Webview:** `webview-ui/src/constants.ts`
- **CSS variables:** `webview-ui/src/index.css` `:root` block (`--pixel-*` properties)

### UI Styling

The project uses a pixel art aesthetic. All overlays should use:

- Sharp corners (`border-radius: 0`)
- Solid backgrounds and `2px solid` borders
- Hard offset shadows (`2px 2px 0px`, no blur) — use `var(--pixel-shadow)`
- The FS Pixel Sans font (loaded in `index.css`)

These conventions are enforced by custom ESLint rules (`eslint-rules/pixel-agents-rules.mjs`):

| Rule | Scope | What it checks |
|---|---|---|
| `no-inline-colors` | Extension + Webview | No hex/rgb/rgba/hsl/hsla literals outside `constants.ts` |
| `pixel-shadow` | Webview only | Box shadows must use `var(--pixel-shadow)` or `2px 2px 0px` |
| `pixel-font` | Webview only | Font family must reference FS Pixel Sans |

These rules are set to `warn` — they won't block your PR but will flag violations for cleanup.

## Submitting a Pull Request

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Verify everything passes locally:
   ```bash
   npm run lint                         # Extension lint
   cd webview-ui && npm run lint && cd ..  # Webview lint
   npm run build                        # Type check + esbuild + Vite
   ```
   CI runs these same checks automatically on every PR.
4. Open a pull request against `main` with:
   - A **conventional commit PR title** (e.g. `feat: add zoom controls`, `fix: character freezing on terminal close`, `refactor: extract pathfinding module`). CI enforces this format — see [Conventional Commits](https://www.conventionalcommits.org/).
   - A clear description of what changed and why
   - How you tested the changes (steps to reproduce / verify)
   - **Screenshots or GIFs for any UI changes**

> **Note:** PRs are merged using **squash and merge** — all commits in your PR are combined into a single commit on `main`. Your PR title becomes the commit message, which is why the conventional commit format matters.

## Reporting Bugs

[Open a bug report](https://github.com/pablodelucca/pixel-agents/issues/new?template=bug_report.yml) — the form will guide you through providing the details we need.

## Feature Requests

Have an idea? [Open a feature request](https://github.com/pablodelucca/pixel-agents/issues/new?template=feature_request.yml) — the form will guide you through describing the problem and your proposed solution. You can also browse and join ongoing conversations in [Discussions](https://github.com/pablodelucca/pixel-agents/discussions).

## Security Issues

Please report security vulnerabilities privately — see [SECURITY.md](SECURITY.md) for details.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
