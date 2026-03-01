# Pixel Agents Regression Checklist (OpenClaw Mode)

Use this quick checklist after functional changes.

## Setup
- [ ] VS Code project opened at `pixel-agents`
- [ ] Extension host started (`F5`)
- [ ] Provider set to `openclaw-session`
- [ ] `pixelAgents.openclaw.maxObservedAgents = 4`
- [ ] `pixelAgents.openclaw.maxSessionAgeMinutes = 120`

## Core UI Stability
- [ ] Panel opens without error
- [ ] No uncontrolled mass-spawning
- [ ] `OpenClaw Observer` terminal exists

## Team Roster
- [ ] Exactly 4 core agents visible
- [ ] Names are correct:
  - [ ] Sam
  - [ ] Trading Exec
  - [ ] Trading Radar
  - [ ] Trading Risk
- [ ] No duplicate/missing labels

## Activity/Status
- [ ] Running command appears as active status (hover text)
- [ ] Memory/search/session tools show friendly status labels
- [ ] Thinking phases do not immediately drop to idle
- [ ] Waiting transitions are smooth (no hard flicker)

## Rotation / Session Handling
- [ ] New sessions do not duplicate already assigned files
- [ ] If cap is reached, observer rotates cleanly (label updates)
- [ ] Historical backlog does not flood office on first scan

## Notes
Write anomalies here with timestamp and brief repro steps.
