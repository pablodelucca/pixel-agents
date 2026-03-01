## ADDED Requirements
### Requirement: Auto Mode Orchestration
The system SHALL provide an "Auto Mode" capability that spawns multiple agents and automatically manages a turn-based conversation between them.

#### Scenario: Starting Auto Mode
- **WHEN** the user activates Auto Mode
- **THEN** the system spawns at least two agents with distinct conversational roles
- **AND** the system initiates the conversation with a seed prompt to the first agent

#### Scenario: Turn-Based Conversation Loop
- **WHEN** an agent completes its turn in Auto Mode
- **THEN** the system extracts the agent's assistant response
- **AND** the system sends that response as the next user prompt to the subsequent agent in the rotation
- **AND** the inactive agents resume their wander/idle states in the simulation
