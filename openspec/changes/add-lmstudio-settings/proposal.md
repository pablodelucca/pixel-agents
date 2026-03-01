# Proposal: Add LM Studio Settings

## Motivation

Pixel Agents currently launches the Anthropic `claude` CLI by default. Users want to natively use local LLM providers, specifically LM Studio. LM Studio can act as an OpenAI-compatible endpoint or an Anthropic-compatible endpoint. The 1st-party `claude` CLI supports this via standard environment variables: `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`, along with a `--model` flag.

## Proposed Solution

1. Add VS Code configuration settings specifically tailored for LM Studio:
   - Base URL (`pixel-agents.lmstudio.baseUrl` - default: `http://localhost:1234/v1` or `http://localhost:1234`)
   - Model Name (`pixel-agents.lmstudio.model` - e.g., `openai/custom-model`)
2. Add a boolean toggle `pixel-agents.lmstudio.enabled` to easily turn this feature on or off.
3. Update the `launchNewTerminal` logic in `src/agentManager.ts` to inject these environment variables and append the `--model` flag if LM Studio is enabled.
4. This approach is "no-code" for the transcript parser, since the `claude` CLI still generates standard `.jsonl` transcript logs.

## Scope
- Modify `package.json` to contribute new LM Studio configuration settings.
- Modify `src/agentManager.ts` terminal creation and command logic.
- Minimal, clean, and directly addresses the requirement without rewriting the core parsing engine.
