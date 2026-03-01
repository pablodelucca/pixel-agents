## 1. Keyword-Based Termination
- [ ] 1.1 Define `AUTO_MODE_TERMINATION_KEYWORD` constant (default `[CONVERSATION_END]`) in `devServer.ts`
- [ ] 1.2 Add keyword detection in `parseTranscriptLine()` -- when an assistant text block contains the keyword, set a `terminationDetected` flag
- [ ] 1.3 Strip the keyword from the text before broadcasting `agentMessage` so it does not appear in the UI bubble
- [ ] 1.4 In `pollJsonl()`, after parsing, if `terminationDetected` is true, call `stopAutoMode()` instead of proceeding to `handleAutoModeTurnEnd()`

## 2. System Prompt and Diverse Conversation Prompts
- [ ] 2.1 Write an `AUTO_MODE_SYSTEM_PROMPT` constant that instructs agents to: explore topics deeply, ask follow-up questions, debate constructively, and emit the termination keyword only when the topic is genuinely exhausted
- [ ] 2.2 Expand `SEED_PROMPTS` to at least 15 open-ended debate-style topics with phrasing that encourages extended discussion
- [ ] 2.3 When starting auto mode, prepend the system prompt to the seed prompt text written to Agent 1's stdin (formatted as a context block the LLM can parse)

## 3. Stop Auto Mode from UI
- [ ] 3.1 Add `stopAutoMode` message handler in `devServer.ts` `handleClientMessage()` that calls `stopAutoMode()`
- [ ] 3.2 In `App.tsx`, update `handleToggleAutoMode` to send `{ type: 'stopAutoMode' }` when toggling off
- [ ] 3.3 Add `autoModeEnded` listener in `useExtensionMessages.ts` that calls a callback to reset `isAutoMode` to false
- [ ] 3.4 Wire the `autoModeEnded` callback from `useExtensionMessages` into `App.tsx` state management

## 4. Interaction Pattern Architecture
- [ ] 4.1 Define `InteractionPattern` type (`'walk-to-agent' | 'stay-at-desk'`) in a shared types file or alongside `AutoModeState`
- [ ] 4.2 Add `interactionPattern: InteractionPattern` field to `AutoModeState` (default `'walk-to-agent'`)
- [ ] 4.3 Broadcast `autoModeStarted` event to webview clients with both agent IDs and the interaction pattern

## 5. Walk-to-Agent Movement
- [ ] 5.1 Add `walkToAgent(agentId: number, targetAgentId: number)` method to `OfficeState` that pathfinds agent to a tile adjacent to the target agent's current position
- [ ] 5.2 In `useExtensionMessages.ts`, handle `autoModeStarted` and `autoModeTurnChange` events to trigger `walkToAgent()` on the responding agent's character
- [ ] 5.3 Update `updateCharacter()` in `characters.ts` to support an `autoModeTarget` override: when set, the agent walks to the target instead of returning to seat when active
- [ ] 5.4 On `autoModeEnded`, clear `autoModeTarget` for both agents and call `sendToSeat()` to return them to their desks

## 6. Verification
- [ ] 6.1 Manual test: start auto mode, verify agents converse with diverse topics and one eventually emits the keyword to end the session
- [ ] 6.2 Manual test: verify the failsafe timer still terminates auto mode if the keyword is never emitted (e.g. set duration to 30 seconds)
- [ ] 6.3 Manual test: click the Auto button while auto mode is active and verify it stops, and the button returns to inactive state
- [ ] 6.4 Manual test: verify the responding agent visually walks toward the other agent during auto mode
- [ ] 6.5 Manual test: verify both agents return to their seats after auto mode ends
- [ ] 6.6 Run `make build` to confirm no compile errors
