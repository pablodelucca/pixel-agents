# Change: Fix Auto Mode Loop and Add Agent Bubbles

## Why
Auto Mode currently loops indefinitely with agents exchanging repetitive goodbye messages. The conversation lacks diversity, and the UI doesn't display what agents are actually saying - only showing status indicators like "Idle" or tool activity.

## What Changes
- Adds a configurable **max duration timer** (default 5 minutes) to terminate auto mode automatically
- Implements **diverse seed prompts** with rotating topics to prevent repetitive conversations
- Adds **agent message bubbles** in the UI showing the agent's last response text when hovered/selected
- Broadcasts `agentMessage` events from devServer containing the agent's last assistant text

## Impact
- Affected specs: `auto-mode` (modify existing capability)
- Affected code: `webview-ui/devServer.ts`, `webview-ui/src/office/components/ToolOverlay.tsx`, `webview-ui/src/hooks/useExtensionMessages.ts`
