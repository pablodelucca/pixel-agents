# Design: Local LLM Proxy Configuration

## Overview

To bridge the Anthropic-only `claude` CLI with OpenAI-compatible local endpoints, Pixel Agents will dynamically spin up a `litellm` proxy before launching the `claude` agent in the same VS Code Terminal.

## VS Code Configuration

Add a new block to `contributes.configuration` in `package.json`:
- `pixel-agents.local.enabled` (boolean, default: false)
- `pixel-agents.local.baseUrl` (string, default: "http://localhost:1234/v1")
- `pixel-agents.local.apiKey` (string, default: "lmstudio")
- `pixel-agents.local.model` (string, default: "openai/local-model")

## Terminal Launch Logic

In `src/agentManager.ts`, the `launchNewTerminal` method will be updated to orchestrate both the proxy and the agent.

1. **Port Identification**: We will define a default local proxy port (e.g., `4000`) and increment it per terminal (`4000 + idx`) to avoid binding collisions when launching multiple agents concurrently.

2. **Environment Assembly**:
   The `claude` CLI will be pointed to this bespoke proxy:
   ```typescript
   const proxyPort = 4000 + idx;
   env['ANTHROPIC_BASE_URL'] = `http://0.0.0.0:${proxyPort}`;
   env['ANTHROPIC_AUTH_TOKEN'] = 'litellm'; // Mock token for local proxy
   ```

3. **Command Orchestration**:
   Instead of just sending `claude --session-id ...`, we will send a chained command to start the proxy in the background, wait briefly, and then start `claude`.

   ```bash
   # Simplified representation of the terminal command
   npx -y litellm --model <model> --api_base <baseUrl> --port <proxyPort> &
   sleep 2
   claude --session-id <sessionId> --model <model>
   ```

   *Self-Correction*: The node child_process or a separate task could manage the proxy, but executing it directly in the same VS Code terminal allows the user to see proxy logs (errors/hits) right next to their Claude Code output, aiding debugging for local LLMs. It also ensures the proxy dies when the user closes the terminal.
