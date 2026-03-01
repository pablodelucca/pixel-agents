# Change: Auto Mode Multi-Agent Interaction

## Why
Users currently have to manually interact with a single agent to see them typing in the Pixel Agents simulation. An "Auto Mode" where two or more agents converse with each other automatically would create a self-sustaining, dynamic simulation where agents take turns working and wandering without requiring constant user input.

## What Changes
- Adds an **"Auto Mode"** toggle/button to the webview UI.
- Implements an orchestrator in the dev server (and extension host) that can spawn multiple agents and manage a conversation loop between them.
- When Agent A finishes its turn, its response is automatically piped as the user prompt to Agent B, creating an infinite conversation loop.
- The existing simulation logic will naturally handle the visual interaction: the active agent will walk to their seat and type, while the inactive agent(s) will stand up and wander around the office until it is their turn.

## Impact
- Affected specs: `auto-mode` (new capability)
- Affected code: `webview-ui/src/App.tsx`, `webview-ui/devServer.ts`, `src/agentManager.ts`
