## MODIFIED Requirements

### Requirement: Auto Mode Orchestration
The system SHALL provide an "Auto Mode" capability that spawns multiple agents and automatically manages a turn-based conversation between them with configurable duration limits.

#### Scenario: Starting Auto Mode
- **WHEN** the user activates Auto Mode
- **THEN** the system spawns at least two agents with distinct conversational roles
- **AND** the system initiates the conversation with a randomly selected seed prompt from a diverse topic pool

#### Scenario: Turn-Based Conversation Loop
- **WHEN** an agent completes its turn in Auto Mode
- **THEN** the system extracts the agent's assistant response
- **AND** the system sends that response as the next user prompt to the subsequent agent in the rotation
- **AND** the inactive agents resume their wander/idle states in the simulation

#### Scenario: Auto Mode Duration Limit
- **WHEN** Auto Mode has been active for the configured maximum duration (default 5 minutes)
- **THEN** the system SHALL automatically terminate Auto Mode
- **AND** the system SHALL broadcast an `autoModeEnded` event to connected clients

#### Scenario: Agent Message Display
- **WHEN** an agent produces an assistant text response
- **THEN** the system SHALL broadcast an `agentMessage` event containing the agent ID and message text
- **AND** the UI SHALL display the agent's last message when the agent is hovered or selected
