## Context
Auto Mode (implemented in `add-auto-mode` and `fix-auto-mode-loop`) currently supports turn-based conversation between two agents via `.jsonl` transcript polling in `webview-ui/devServer.ts`. The conversation ends only when the 5-minute duration timer expires or an agent process exits. This enhancement spans three systems: the dev server (orchestration), the webview React app (UI state), and the office simulation engine (character movement).

## Goals / Non-Goals

- Goals:
  - Agents can signal conversation completion via a keyword detected by the server
  - Duration timer remains as a fail-safe for when the keyword is never emitted
  - UI can stop auto mode and stays in sync with server state
  - Seed prompts and system instructions keep conversations diverse and sustained
  - Characters walk toward each other during auto mode instead of sitting at their own desks
  - Architecture supports future interaction patterns (configurable via an `InteractionPattern` type)

- Non-Goals:
  - Full A* pathfinding rewrite (existing `findPath()` from `tileMap.ts` is sufficient)
  - Extension host (`src/agentManager.ts`) auto mode support (dev-server only for now)
  - Multi-agent (3+) auto mode conversations
  - Persistent conversation history or memory across auto mode sessions

## Decisions

### Termination keyword approach
- **Decision**: Inject a system prompt instruction telling agents to output `[CONVERSATION_END]` when they believe the discussion is complete. The server scans each assistant text block for this exact string.
- **Alternatives considered**:
  - Sentiment analysis / NLP detection of "goodbye" patterns -- rejected, too complex and unreliable
  - Agent function-call / tool-use to signal end -- rejected, requires tool registration and adds protocol complexity
  - Token count threshold -- rejected, doesn't reflect conversation quality
- **Rationale**: Simple string matching is deterministic, easy to test, and the keyword is unlikely to appear in natural conversation. The system prompt gives the LLM clear instructions on when to use it.

### Keyword configuration
- **Decision**: The keyword defaults to `[CONVERSATION_END]` and is defined as a constant. A future configuration option can override it, but for now it is hardcoded.
- **Rationale**: Simplicity first. One constant in `devServer.ts` is sufficient.

### System prompt injection
- **Decision**: When starting auto mode, prepend a system-level instruction to each agent's first message that explains: (1) they are in a collaborative conversation with another agent, (2) they should explore topics deeply, ask follow-up questions, and debate, (3) they should emit `[CONVERSATION_END]` only when both agree the topic is exhausted.
- **Rationale**: This is the simplest way to influence LLM behavior without modifying the agent spawn protocol. The instruction is written to the agent's stdin as a prefixed context block before the seed prompt.

### Walk-to-agent interaction pattern
- **Decision**: Add a `walkToAgent(agentId, targetAgentId)` method to `OfficeState` that pathfinds agent A to a tile adjacent to agent B's current position. During auto mode, when an agent receives a message to respond to, they walk toward the other agent instead of returning to their seat. When auto mode ends, both agents return to their seats via the existing `sendToSeat()` flow.
- **Alternatives considered**:
  - Meet at a fixed "meeting point" tile -- rejected, less dynamic and requires layout knowledge
  - Both agents walk to a midpoint -- rejected, more complex coordinate math for minimal visual benefit
- **Rationale**: Walking to the other agent is the most natural visual representation of "going to talk to someone." The target tile is recalculated each turn since agents may be moving.

### InteractionPattern type (future-proofing)
- **Decision**: Define an `InteractionPattern` union type (`'walk-to-agent' | 'stay-at-desk'`) in the auto mode state. For this change, only `walk-to-agent` is implemented. The pattern is stored in `AutoModeState` and read by the character update logic.
- **Rationale**: Adding the type now is zero-cost and prevents a refactor when new patterns are added later.

### UI stop/sync
- **Decision**: Add a `stopAutoMode` WebSocket message type. When the Auto button is toggled off, send `{ type: 'stopAutoMode' }`. The server calls `stopAutoMode()` and broadcasts `autoModeEnded`. The webview listens for `autoModeEnded` in `useExtensionMessages.ts` and resets `isAutoMode` to false.
- **Rationale**: Fixes the existing bug where the UI stays in "active" state after server-side auto mode ends.

## Risks / Trade-offs

- **Risk**: LLM ignores the termination keyword instruction and never emits it.
  - Mitigation: The duration timer fail-safe ensures auto mode always terminates. The system prompt is strongly worded.
- **Risk**: LLM emits the keyword too early (first or second turn).
  - Mitigation: The system prompt instructs agents to have a substantive discussion before concluding. Seed prompts are designed as open-ended debates.
- **Risk**: `walkToAgent()` target tile is occupied or unreachable.
  - Mitigation: Fall back to the nearest walkable tile adjacent to the target. If no path exists, agent stays in place (no crash).
- **Risk**: Both agents try to walk to each other simultaneously, causing oscillation.
  - Mitigation: Only the responding agent (the one whose turn is starting) walks to the other agent. The speaking agent stays put until their turn.

## Open Questions
- Should the termination keyword be configurable via environment variable or UI setting? (Deferred to a future change.)
- Should there be a minimum turn count before the keyword is honored? (Deferred -- system prompt discouragement is sufficient for now.)
