## 1. UI Integration
- [x] 1.1 Add an "Auto Mode" button to the BottomToolbar in `webview-ui/src/components/BottomToolbar.tsx`
- [x] 1.2 Send a `startAutoMode` message to the backend when clicked

## 2. Dev Server Orchestration
- [x] 2.1 Update `devServer.ts` to handle `startAutoMode` by spawning Agent 1 and Agent 2
- [x] 2.2 Seed the conversation by sending an initial topic to Agent 1's stdin
- [x] 2.3 Add logic in `handleClientMessage` or `pollJsonl` that intercepts `turn_duration` from Agent A, extracts the last output, and pipes it as `stdinInput` to Agent B (and vice versa)

## 3. Extension Orchestration (Optional but recommended)
- [~] 3.1 Replicate the auto-mode orchestration logic in `agentManager.ts` so the VS Code extension supports it as well
- [~] 3.2 Add a VS Code command `pixelAgents.startAutoMode` to complement the UI button
