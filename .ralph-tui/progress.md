# Ralph Progress Log

This file tracks progress across iterations. Agents update this file
after each iteration and it's included in prompts for context.

## Codebase Patterns (Study These First)

*Add reusable patterns discovered during development here.*

---
## [2026-03-01] - US-001
- Implemented termination keyword constant and detection in transcript parser
- Files changed: `webview-ui/devServer.ts`
- **Learnings:**
  - The `parseTranscriptLine()` function returns an object with flags like `isTurnEnd`, `assistantText`, and now `terminationDetected`
  - Keyword stripping uses simple `String.replace()` with trim to clean whitespace
  - The `pollJsonl()` function handles both termination detection and turn-end handling with priority given to termination
  - Type checking for this project requires `--project tsconfig.json` flag (not direct file compilation)
---
## [2026-03-01] - US-003
- Added stopAutoMode message handler case in handleClientMessage()
- Files changed: `webview-ui/devServer.ts`
- **Learnings:**
  - Message handlers follow a simple if-else chain pattern in handleClientMessage()
  - The stopAutoMode() function is idempotent - it safely handles null autoMode state
---
## [2026-03-01] - US-002
- Added AUTO_MODE_SYSTEM_PROMPT constant with instructions for sustained conversation
- Expanded SEED_PROMPTS from 10 to 17 diverse debate-style topics
- Modified startAutoMode() to prepend system prompt to seed prompt
- Files changed: `webview-ui/devServer.ts`
- **Learnings:**
  - System prompt injection uses simple string concatenation before the seed prompt
  - The system prompt references the termination keyword constant to keep instructions consistent
  - Template literal with embedded constant maintains single source of truth for the keyword
---
## [2026-03-01] - US-004
- Wired UI Auto button to stop auto mode and sync autoModeEnded state
- Files changed: `webview-ui/src/App.tsx`, `webview-ui/src/hooks/useExtensionMessages.ts`
- **Learnings:**
  - React state must be declared before being used in callbacks passed to hooks (ESLint catches this as "accessed before declared")
  - The `useExtensionMessages` hook accepts callback parameters for events that need to update parent state
  - Message handlers in `useExtensionMessages` follow a simple if-else pattern for different message types
  - The `autoModeEnded` broadcast from server triggers UI state reset via callback pattern
---
## [2026-03-01] - US-005
- Defined InteractionPattern type and extended AutoModeState with interactionPattern field
- Broadcast autoModeStarted event with agentIds and interactionPattern
- Files changed: `webview-ui/devServer.ts`
- **Learnings:**
  - Type definitions can be placed alongside interfaces in the same file for simple cases
  - Union types like `InteractionPattern` enable future extensibility without refactoring existing code
  - The `broadcast()` function is used to send events to all connected webview clients
  - Default values for new fields should be set when creating the state object
---
## [2026-03-01] - US-006
- Added walkToAgent method to OfficeState for agent-to-agent pathfinding during auto mode
- Files changed: `webview-ui/src/office/engine/officeState.ts`
- **Learnings:**
  - The `withOwnSeatUnblocked()` wrapper is essential for pathfinding - it temporarily unblocks the agent's own seat tile so they can pathfind through it
  - Adjacent tile discovery should check walkability first, then sort by distance to prioritize closest tiles
  - The method returns boolean to indicate success/failure, allowing caller to handle no-path scenarios gracefully
  - Pathfinding uses the existing `findPath()` function from tileMap.ts which returns an empty array if no path exists
  - Character state must be set to WALK and frame timers reset when starting movement
---
## [2026-03-01] - US-007
- Wired walk-to-agent behavior into character FSM and auto mode events
- Added autoModeTarget field to Character interface for tracking interaction target
- Updated updateCharacter() to skip seat return logic when autoModeTarget is set
- Added autoModeTurnChange broadcast event in devServer to trigger walks on turn changes
- Handled autoModeStarted, autoModeTurnChange, and autoModeEnded events in useExtensionMessages
- Files changed: `webview-ui/src/office/types.ts`, `webview-ui/src/office/engine/characters.ts`, `webview-ui/devServer.ts`, `webview-ui/src/hooks/useExtensionMessages.ts`
- **Learnings:**
  - The Character FSM needs conditional logic to differentiate between normal seat-return behavior and auto mode interaction behavior
  - Event-driven architecture: message handlers directly call OfficeState methods (walkToAgent, sendToSeat) rather than managing state in the handler
  - The autoModeTarget field acts as a flag in the FSM to prevent unwanted seat-return pathfinding during auto mode
  - Only the responding agent (whose turn is starting) should walk to avoid oscillation - the speaking agent stays put
  - Clearing autoModeTarget and calling sendToSeat on autoModeEnded ensures agents return to normal behavior
---

