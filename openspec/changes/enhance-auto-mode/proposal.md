# Change: Enhance Auto Mode with Keyword Termination, Failsafe Timer, and Agent Interaction Patterns

## Why
Auto Mode currently relies solely on a hard duration timer to end conversations, and agents frequently devolve into repetitive goodbye exchanges. There is no way for agents to signal they are "done" naturally, no way to stop auto mode from the UI, and the conversation prompts lack enough variety to sustain extended discussions. Additionally, the visual simulation does not reflect agents interacting with each other -- they simply sit at their own desks.

## What Changes
- **Keyword-based termination**: Agents are instructed (via system prompt) to emit a configurable termination keyword (e.g. `[CONVERSATION_END]`) when they believe the conversation has reached a natural conclusion. The server detects this keyword in assistant output and stops auto mode gracefully.
- **Failsafe timer**: The existing duration timer is retained as a fail-safe. If the keyword is never emitted, auto mode still terminates after the configured max duration (default 5 minutes, env-configurable).
- **Stop auto mode from UI**: A `stopAutoMode` message is added so the Auto button can toggle auto mode off, and the webview listens for `autoModeEnded` to sync UI state.
- **Diverse conversation prompts**: Expand and restructure seed prompts to include a wider variety of topics and instruct agents to explore tangents, debate, and ask follow-up questions -- preventing early convergence to goodbyes.
- **Agent interaction pattern (walk-to-agent)**: When an agent has something to say in auto mode, their character walks toward the other agent's position instead of staying at their own desk. This establishes the `InteractionPattern` architecture for future extensibility (e.g. gather-at-table, stand-at-whiteboard).

## Impact
- Affected specs: `auto-mode` (modify existing capability)
- Affected code:
  - `webview-ui/devServer.ts` -- keyword detection, stop handler, expanded prompts, system prompt injection
  - `webview-ui/src/office/engine/officeState.ts` -- `walkToAgent()` method, interaction pattern support
  - `webview-ui/src/office/engine/characters.ts` -- FSM update for walk-to-agent during auto mode
  - `webview-ui/src/hooks/useExtensionMessages.ts` -- `autoModeEnded` listener
  - `webview-ui/src/components/BottomToolbar.tsx` -- stop auto mode toggle
  - `webview-ui/src/App.tsx` -- wire stop message and autoModeEnded state sync
