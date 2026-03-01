# Proposal: Add OpenAI Compatible Local LLM Proxy

## Motivation

Pixel Agents currently launches the Anthropic `claude` CLI by default. Users want to natively use local OpenAI-compatible LLM providers (like LM Studio, Ollama, vLLM). However, the `claude` CLI natively only speaks the Anthropic API format. Directly pointing `claude` to OpenAI endpoints (even experimental Anthropic-compatible ones from local providers) often leads to authentication conflicts or feature incompatibility. 

To provide a robust, generic "OpenAI Compatible Local LLM" integration, we need a translation layer. LiteLLM is the industry standard proxy for this.

## Proposed Solution

1. Add generic VS Code configuration settings:
   - Base URL (`pixel-agents.local.baseUrl` - e.g., `http://localhost:1234/v1`)
   - API Key (`pixel-agents.local.apiKey` - optional, often 'lmstudio' or 'ollama')
   - Model Name (`pixel-agents.local.model` - e.g., `openai/custom-model`)
2. Add a boolean toggle `pixel-agents.local.enabled` to easily turn this feature on or off.
3. Update the `launchNewTerminal` logic in `src/agentManager.ts`:
   - If `enabled` is true, first launch `npx litellm` in the background within the terminal to act as a proxy.
   - Configure the `litellm` proxy to map an Anthropic-compatible endpoint to the user's configured `baseUrl` and `apiKey`.
   - Then launch the `claude` CLI, pointing its `ANTHROPIC_BASE_URL` to the local `litellm` proxy and passing the `--model`.
4. This approach is "no-code" for the transcript parser, since the `claude` CLI still generates standard `.jsonl` transcript logs.

## Scope
- Modify `package.json` to contribute new local execution configuration settings.
- Modify `src/agentManager.ts` terminal creation and command logic to securely span the proxy and the claude agent.
