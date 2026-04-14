# Local Preview and Release Flow

This repository supports three different ways of trying changes:

1. **Extension Development Host** - fastest feedback while coding with `F5`
2. **Local preview VSIX** - install the current branch as a packaged extension in your normal VS Code
3. **Public release** - publish to VS Code Marketplace and Open VSX through the GitHub release workflow

Use the local preview flow before opening a PR when you want to validate the real packaged extension outside the development host.

## 1. Build a local preview VSIX

From the repository root:

```bash
npm install
cd webview-ui && npm install && cd ..
cd server && npm install && cd ..
npm run package
npx @vscode/vsce package -o pixel-agents-1.3.0-dev.1-local.vsix
```

Notes:

- `npm run package` builds the production extension output.
- `npx @vscode/vsce package` creates the installable `.vsix`.
- You can change the output filename if you want to embed a branch name or date.

## 2. Install the local preview in VS Code

In VS Code:

1. Open the **Extensions** view.
2. Click the `...` menu in the top-right.
3. Choose **Install from VSIX...**
4. Select the generated `.vsix`
5. Reload VS Code when prompted

After installation, open the extension details page and confirm the expected version.

## 3. Update the local preview build

When you make new changes:

```bash
npm run package
npx @vscode/vsce package -o pixel-agents-1.3.0-dev.1-local.vsix
```

Then install the new VSIX again from **Install from VSIX...**. VS Code replaces the previous local build of the same extension identifier.

## 4. Remove the local preview build

You can remove it from the Extensions view like any other extension:

1. Search for **Pixel Agents**
2. Open the gear menu
3. Choose **Uninstall**

If you had the marketplace version installed before, reinstall the marketplace version after removing the local preview.

## 5. Local preview vs pre-release

A local VSIX is **not** the same thing as a marketplace pre-release channel.

- **Local VSIX**: manual install on your machine only
- **Marketplace pre-release**: downloadable by other users from the extension listing

At the moment, this repository's publish workflow is set up for normal releases triggered from GitHub Releases. It does **not** currently define a separate marketplace pre-release publishing path.

That means the recommended flow for this branch is:

1. build a local VSIX
2. test it locally
3. open a PR
4. merge to `main`
5. create a GitHub Release when the change is ready for public distribution

## 6. Public release flow

The current publish workflow lives in `.github/workflows/publish-extension.yml`.

Public release flow:

1. Merge the PR into `main`
2. Create a GitHub Release
3. GitHub Actions packages the extension
4. The workflow publishes to:
   - VS Code Marketplace
   - Open VSX
5. The generated VSIX is also uploaded to the GitHub Release

## 7. Recommended validation before packaging

Before generating the local VSIX, run:

```bash
npm run lint
npm run build
npm test
npm run e2e
```

For provider work, also keep the focused matrix handy:

```bash
npm run test:server -- providerEventRouter.test.ts codexEventMapper.test.ts codexAppServerClient.test.ts providerPreferences.test.ts providerTerminalMatcher.test.ts providerRegistry.test.ts hookEventHandler.test.ts
npm run e2e -- --grep "switching to Codex and clicking \\+ Agent|provider switcher can spawn one Claude terminal and one Codex terminal|codex spawnAgent activity appears as a subagent in debug view|six cloned agents"
```
