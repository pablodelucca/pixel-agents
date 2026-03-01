# Design: LM Studio Configuration

## Overview
We will inject `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` into the VS Code Terminal environment, and append `--model <value>` to the `claude` CLI command, specifically targeting LM Studio users.

## VS Code Configuration
We will add a new block to `contributes.configuration` in `package.json`:
- `pixel-agents.lmstudio.enabled` (boolean, default: false)
- `pixel-agents.lmstudio.baseUrl` (string, default: "http://localhost:1234")
- `pixel-agents.lmstudio.model` (string, default: "openai/local-model")

*Note: The auth token for LM Studio is usually ignored or can be anything (like "lmstudio"), so we will hardcode `ANTHROPIC_AUTH_TOKEN` to "lmstudio" when this mode is enabled, simplifying the UX.*

## Terminal Launch Logic
In `src/agentManager.ts`, the `launchNewTerminal` method uses `vscode.window.createTerminal({ name, cwd })`. We will update this to:
```typescript
const config = vscode.workspace.getConfiguration('pixel-agents.lmstudio');
const isEnabled = config.get<boolean>('enabled');
const baseUrl = config.get<string>('baseUrl');
const model = config.get<string>('model');

const env: Record<string, string> = {};
if (isEnabled && baseUrl) {
    env['ANTHROPIC_BASE_URL'] = baseUrl;
    env['ANTHROPIC_AUTH_TOKEN'] = 'lmstudio'; // Hardcode for LM Studio
}

const terminalOptions: vscode.TerminalOptions = {
    name: `${TERMINAL_NAME_PREFIX} #${idx}`,
    cwd,
};
if (Object.keys(env).length > 0) {
    terminalOptions.env = env;
}
const terminal = vscode.window.createTerminal(terminalOptions);

let command = `claude --session-id ${sessionId}`;
if (isEnabled && model) {
    command += ` --model ${model}`;
}
terminal.sendText(command);
```
