# Spec: LM Studio Settings

## ADDED Requirements

### Requirement: Configure LM Studio Environment
The extension MUST allow users to enable LM Studio and define a base URL and model name via VS Code settings (`pixel-agents.lmstudio.*`). When enabled, these settings MUST be applied to newly spawned Claude CLI terminals, and the `ANTHROPIC_AUTH_TOKEN` MUST be automatically set to "lmstudio".

#### Scenario: User enables LM Studio
Given the user has set `pixel-agents.lmstudio.enabled` to true
And the user has set `pixel-agents.lmstudio.baseUrl` to "http://localhost:1234/v1"
And the user has set `pixel-agents.lmstudio.model` to "openai/custom-model"
When the user clicks "+ Agent"
Then a terminal should be created with the env vars `ANTHROPIC_BASE_URL`="http://localhost:1234/v1" and `ANTHROPIC_AUTH_TOKEN`="lmstudio"
And the terminal should execute `claude --session-id <id> --model openai/custom-model`
