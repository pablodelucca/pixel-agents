# OpenClaw + OpenAI Integration Plan (Beginner-Friendly)

This file is the working plan to adapt Pixel Agents from Claude-specific tracking to OpenClaw session tracking.

## Goal

Show Sam + sub-agents as pixel characters based on real OpenClaw activity:
- idle
- working (tools running)
- waiting (needs user)
- done (finished turn/task)

---

## What is different from original Pixel Agents?

Original project reads Claude JSONL transcripts.

For Ronald's setup, we will:
1. Keep the visual office UI (already great)
2. Replace the activity source with OpenClaw events/session data
3. Keep logic framework-neutral so we can still support Claude mode later

---

## Implementation Phases

## Phase 1 — Foundation (safe)
- [x] Add a provider interface for activity data ("agent event source")
- [x] Keep existing Claude parser behind provider `claude-jsonl`
- [x] Add new provider skeleton `openclaw-session`
- [x] Add extension setting: `pixelAgents.provider` (`claude-jsonl` | `openclaw-session`)

Result: no behavior break, architecture ready.

## Phase 2 — OpenClaw data adapter (MVP)
- [x] Read OpenClaw session activity (polling first)
- [x] Map raw activity to normalized events:
  - tool_start
  - tool_done
  - waiting
  - done (via assistant text completion / idle)
- [x] Feed events into existing character state machine
- [x] Stabilize observer mode:
  - single observer terminal
  - EOF start (no stale replay)
  - prevent historical mass-spawn on first scan
  - configurable observed-agent cap (`pixelAgents.openclaw.maxObservedAgents`)

Result: characters react to OpenClaw-based activity in a stable observer baseline.

## Phase 3 — UX polish
- [x] Better status confidence (first pass; reduced false waiting transitions)
- [ ] Sub-agent parent/child links (if available in source events)
- [ ] Optional channel tags (discord/cron/main) in debug overlay

Result: reliable daily use.

---

## Status Mapping (initial)

OpenClaw signal -> Pixel state:
- Any tool running -> WORKING (typing/reading by tool type)
- New user-required prompt / no progress timeout -> WAITING
- Turn completion / task completion -> DONE (brief) then IDLE
- No active events -> IDLE

---

## What Ronald might need to do (only if asked)

Most work is done by Sam.

Possible tiny asks later:
1. Install/update VS Code extension host dependencies
2. Confirm which OpenClaw activity source is preferred:
   - local session files
   - gateway API/websocket
3. Test in VS Code and report if statuses look wrong

If action is needed, Sam will provide exact copy-paste steps.

---

## Safety / Risk

- No live trading logic is touched.
- This is UI/observability only.
- Changes are isolated in Pixel Agents fork branch `openclaw-adapter`.

---

## Current Branch

`openclaw-adapter`

