## MODIFIED Requirements

### Requirement: Auto Mode Orchestration
The system SHALL provide an "Auto Mode" capability that spawns multiple agents and automatically manages a turn-based conversation between them. The system SHALL terminate auto mode when agents emit a termination keyword, when the failsafe duration timer expires, or when the user manually stops it from the UI.

#### Scenario: Starting Auto Mode
- **WHEN** the user activates Auto Mode
- **THEN** the system spawns at least two agents with distinct conversational roles
- **AND** the system injects a system prompt instructing agents on conversation behavior and the termination keyword protocol
- **AND** the system initiates the conversation with a randomly selected seed prompt from a diverse topic pool

#### Scenario: Turn-Based Conversation Loop
- **WHEN** an agent completes its turn in Auto Mode
- **THEN** the system extracts the agent's assistant response
- **AND** the system sends that response as the next user prompt to the subsequent agent in the rotation

#### Scenario: Agent Message Display
- **WHEN** an agent produces an assistant text response
- **THEN** the system SHALL broadcast an `agentMessage` event containing the agent ID and message text
- **AND** the UI SHALL display the agent's last message when the agent is hovered or selected

## ADDED Requirements

### Requirement: Keyword-Based Termination
The system SHALL detect a configurable termination keyword (default `[CONVERSATION_END]`) in agent assistant output and stop auto mode when found.

#### Scenario: Agent emits termination keyword
- **WHEN** an agent's assistant response contains the termination keyword
- **THEN** the system SHALL stop auto mode immediately
- **AND** the system SHALL strip the keyword from the displayed message text
- **AND** the system SHALL broadcast an `autoModeEnded` event to connected clients

#### Scenario: Keyword not emitted before timer
- **WHEN** auto mode has been active for the configured maximum duration (default 5 minutes) and no agent has emitted the termination keyword
- **THEN** the system SHALL terminate auto mode via the failsafe timer
- **AND** the system SHALL broadcast an `autoModeEnded` event to connected clients

### Requirement: Failsafe Duration Timer
The system SHALL enforce a configurable maximum duration (default 5 minutes, overridable via `PIXEL_AGENTS_AUTO_MODE_DURATION_MS` environment variable) as a fail-safe that terminates auto mode if the termination keyword is never emitted.

#### Scenario: Timer expires
- **WHEN** the failsafe timer reaches the configured duration
- **THEN** the system SHALL call `stopAutoMode()` and broadcast `autoModeEnded`
- **AND** agents SHALL be returned to their normal idle/wander states

### Requirement: Stop Auto Mode from UI
The system SHALL allow the user to manually stop auto mode via the UI. The UI SHALL stay in sync with the server-side auto mode state.

#### Scenario: User stops auto mode
- **WHEN** the user clicks the Auto button while auto mode is active
- **THEN** the system SHALL send a `stopAutoMode` message to the server
- **AND** the server SHALL terminate auto mode and broadcast `autoModeEnded`

#### Scenario: Server-side auto mode ends
- **WHEN** the server broadcasts `autoModeEnded` (from keyword, timer, or agent exit)
- **THEN** the UI SHALL reset the `isAutoMode` state to false
- **AND** the Auto button SHALL return to its inactive visual state

### Requirement: Diverse Conversation Prompts
The system SHALL provide diverse seed prompts and system-level instructions that sustain extended, substantive conversations between agents.

#### Scenario: System prompt injection
- **WHEN** auto mode starts
- **THEN** the system SHALL prepend a system instruction to the first agent's input that directs agents to explore topics deeply, ask follow-up questions, debate constructively, and only emit the termination keyword when the topic is genuinely exhausted

#### Scenario: Seed prompt variety
- **WHEN** a seed prompt is selected for auto mode
- **THEN** the prompt SHALL be randomly chosen from a pool of at least 10 open-ended, debate-style topics
- **AND** the prompt SHALL be phrased to encourage extended discussion rather than quick agreement

### Requirement: Agent Interaction Pattern - Walk to Agent
During auto mode, the responding agent's character SHALL walk toward the other agent's position instead of returning to their own seat, creating a visual representation of agents interacting with each other.

#### Scenario: Responding agent walks to speaking agent
- **WHEN** it becomes an agent's turn to respond in auto mode
- **THEN** the agent's character SHALL pathfind to a tile adjacent to the other agent's current position
- **AND** the agent SHALL face the other agent upon arrival

#### Scenario: No path to other agent
- **WHEN** the responding agent cannot find a path to a tile adjacent to the other agent
- **THEN** the agent SHALL remain at their current position
- **AND** auto mode SHALL continue without interruption

#### Scenario: Auto mode ends and agents return to seats
- **WHEN** auto mode terminates (by keyword, timer, or user stop)
- **THEN** both agents SHALL pathfind back to their assigned seats
- **AND** both agents SHALL resume normal idle/wander behavior

### Requirement: Interaction Pattern Architecture
The system SHALL define an `InteractionPattern` type that determines how agents physically interact during auto mode. The pattern is stored in `AutoModeState` and read by the character update logic.

#### Scenario: Default interaction pattern
- **WHEN** auto mode starts without an explicit interaction pattern configuration
- **THEN** the system SHALL use `walk-to-agent` as the default interaction pattern

#### Scenario: Future pattern extensibility
- **WHEN** a new interaction pattern is added (e.g. `stay-at-desk`, `meet-at-table`)
- **THEN** the `InteractionPattern` union type SHALL be extended with the new variant
- **AND** the character update logic SHALL handle the new pattern without modifying existing pattern behavior
