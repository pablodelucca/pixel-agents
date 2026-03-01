# Implementation Tasks

- [x] 1. Add Settings to package.json
   - Update `contributes.configuration` with the 3 new `pixel-agents.lmstudio` properties (enabled, baseUrl, model).
   - Ensure these settings appear in the VS Code Settings UI.
- [x] 2. Update agentManager.ts
   - Read the new VS Code configuration settings in `launchNewTerminal`.
   - Pass the `env` object when calling `vscode.window.createTerminal` if `enabled` is true.
   - Append the `--model` argument to the `claude` command if configured and `enabled` is true.
- [x] 3. Validation
   - Compile and start Extension Development Host.
   - Configure LM Studio settings in VS Code.
   - Spawn an agent and verify it launches and applies the correct flags/env in the terminal.
