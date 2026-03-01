## 1. Dev Server Improvements
- [x] 1.1 Add max duration timer to auto mode (default 5 minutes, configurable via env)
- [x] 1.2 Add diverse seed prompts array with random topic selection
- [x] 1.3 Broadcast `agentMessage` events when agent produces assistant text

## 2. UI Agent Bubbles
- [x] 2.1 Add `agentMessages` state in `useExtensionMessages.ts` hook
- [x] 2.2 Handle `agentMessage` events and store last message per agent
- [x] 2.3 Update `ToolOverlay.tsx` to display agent's last message text in bubble/tooltip
- [x] 2.4 Truncate long messages with ellipsis (max ~100 chars visible)
