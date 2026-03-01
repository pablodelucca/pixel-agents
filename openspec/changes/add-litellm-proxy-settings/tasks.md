# Implementation Tasks

- [x] 1. Add Settings to package.json
   - Update `contributes.configuration` with the 4 new `pixel-agents.local` properties (`enabled`, `baseUrl`, `apiKey`, `model`).
   - Remove the old `pixel-agents.lmstudio` settings to avoid confusion.
- [x] 2. Update agentManager.ts
   - Read the new VS Code configuration settings in `launchNewTerminal`.
   - Calculate a unique proxy port based on the terminal `idx`.
   - Pass the `env` object pointing `ANTHROPIC_BASE_URL` to the local proxy port if `enabled` is true.
   - Construct a compound terminal command that starts `npx -y litellm` in the background, sleeps, and then launches `claude`.
- [x] 3. Validation
   - Compile and start Extension Development Host.
   - Configure local LLM settings in VS Code.
   - Spawn an agent and verify both `litellm` and `claude` start successfully in the terminal and communicate.
