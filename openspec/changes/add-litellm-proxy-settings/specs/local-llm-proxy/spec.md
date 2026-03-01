# Spec: Local LLM Proxy Settings

## ADDED Requirements

### Requirement: Configure Local Proxy Environment
The extension MUST allow users to enable a generic local connection and define a base URL, API Key, and model name via VS Code settings (`pixel-agents.local.*`). When enabled, the extension MUST launch a `litellm` proxy configured with these settings, and subsequently launch `claude` pointed at the proxy.

#### Scenario: User enables Local LLM Proxy
Given the user has set `pixel-agents.local.enabled` to true
And the user has set `pixel-agents.local.baseUrl` to "http://localhost:1234/v1"
And the user has set `pixel-agents.local.apiKey` to "lmstudio"
And the user has set `pixel-agents.local.model` to "openai/custom-model"
When the user clicks "+ Agent"
Then a terminal should be created with the env var `ANTHROPIC_BASE_URL` pointing to the localized proxy port
And the terminal should execute a command that starts `npx -y litellm` in the background and then `claude`
