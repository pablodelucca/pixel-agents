# Test Pixel Agents with Codex CLI

## Objective

Provide clear, step-by-step instructions on how the user can test their modified Pixel Agents extension with their running Codex CLI.

## Implementation Plan

- [ ] Task 1. Explain how to launch the extension in development mode via VS Code.
- [ ] Task 2. Explain how to verify the extension's local HTTP server is running.
- [ ] Task 3. Provide a simple curl script/command to simulate Codex CLI events.
- [ ] Task 4. Explain how to integrate these curl commands into the actual Codex CLI workflow.

## Verification Criteria

- [ ] User can launch the extension and see the Webview UI.
- [ ] User can send a mock event and see a character spawn/react.
- [ ] User understands how to connect their actual Codex CLI to the extension.

## Potential Risks and Mitigations

1. **Server Discovery Failure**
   Mitigation: Provide exact paths to `server.json` and commands to read it.
2. **Event Format Mismatch**
   Mitigation: Provide exact JSON payloads that match the expected schema.
