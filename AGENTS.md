# AGENTS.md

## Repo Instructions

- Treat the current source code as the source of truth for architecture and behavior.
- Do not rely on [CLAUDE.md](/Users/bhaskarpandit/Documents/ideal-no/CLAUDE.md) as authoritative project guidance. It documents an earlier Claude-based open source version and is stale for this repo.
- Treat parts of [README.md](/Users/bhaskarpandit/Documents/ideal-no/README.md) and [package.json](/Users/bhaskarpandit/Documents/ideal-no/package.json) as potentially stale where they still mention Claude or older behavior.
- Use [plans/2026-04-15-multi-agent-control-roadmap.md](/Users/bhaskarpandit/Documents/ideal-no/plans/2026-04-15-multi-agent-control-roadmap.md) as the active product-direction reference for what this project is becoming.
- Use Context7 as the first source for any external documentation lookup, including library, framework, API, SDK, and tool docs.
- Use repo-local documentation first when it exists and matches the current code.
- Do not go to general web search or vendor docs first when Context7 can provide the material.
- If Context7 does not have the needed documentation or version-specific detail, say that explicitly before using a fallback source.
- When summarizing external docs, include the relevant package or tool name and version when Context7 provides it.

## Current Reality

- This codebase has been adapted for Codex, not Claude.
- New agent terminals are launched with `codex`, not `claude`. See [src/agentManager.ts](/Users/bhaskarpandit/Documents/ideal-no/src/agentManager.ts).
- Session and project discovery now use `~/.codex`, especially `~/.codex/projects` and `~/.codex/settings.json`. See [src/agentManager.ts](/Users/bhaskarpandit/Documents/ideal-no/src/agentManager.ts) and [server/src/providers/file/codexHookInstaller.ts](/Users/bhaskarpandit/Documents/ideal-no/server/src/providers/file/codexHookInstaller.ts).
- Hook installation and event forwarding are Codex-based. See [server/src/providers/file/codexHookInstaller.ts](/Users/bhaskarpandit/Documents/ideal-no/server/src/providers/file/codexHookInstaller.ts) and [server/src/providers/file/hooks/codex-hook.ts](/Users/bhaskarpandit/Documents/ideal-no/server/src/providers/file/hooks/codex-hook.ts).
- Agent lifecycle and hook routing are centered on [src/PixelAgentsViewProvider.ts](/Users/bhaskarpandit/Documents/ideal-no/src/PixelAgentsViewProvider.ts) and [server/src/hookEventHandler.ts](/Users/bhaskarpandit/Documents/ideal-no/server/src/hookEventHandler.ts).
- User-level Pixel Agents state still lives under `~/.pixel-agents` for layout, config, server discovery, and copied hook scripts.

## Product Direction

- The product direction is multi-agent mission control, not an ambient agent viewer.
- Prefer work that answers these operational questions clearly: who owns what, what each agent is doing now, what changed, what is blocked, and what needs human intervention next.
- Prioritize first-class orchestration entities such as tasks, session runs, approvals, artifacts, event history, and workspace assignments over additional decorative office interactions.
- Treat the canvas office as ambient presence, not the primary control surface.
- Prefer inspector, board, approval, replay, dispatch, briefing, and workspace flows over click-to-terminal shortcuts.
- When choosing between UI work, favor Mission Control Board, Agent Inspector Drawer, Approval Center, Run History, Dispatch Board, and Workspace flows before adding more visual polish.

## Working Rules

- Before changing behavior, inspect the live implementation files that own that behavior instead of inferring from historical docs.
- For agent lifecycle, terminal launch, persistence, or hook registration changes, start with [src/PixelAgentsViewProvider.ts](/Users/bhaskarpandit/Documents/ideal-no/src/PixelAgentsViewProvider.ts), [src/agentManager.ts](/Users/bhaskarpandit/Documents/ideal-no/src/agentManager.ts), and [src/types.ts](/Users/bhaskarpandit/Documents/ideal-no/src/types.ts).
- For hook protocol, server routing, or Codex settings integration, start with [server/src/hookEventHandler.ts](/Users/bhaskarpandit/Documents/ideal-no/server/src/hookEventHandler.ts), [server/src/server.ts](/Users/bhaskarpandit/Documents/ideal-no/server/src/server.ts), [server/src/constants.ts](/Users/bhaskarpandit/Documents/ideal-no/server/src/constants.ts), [server/src/providers/file/codexHookInstaller.ts](/Users/bhaskarpandit/Documents/ideal-no/server/src/providers/file/codexHookInstaller.ts), and [server/src/providers/file/hooks/codex-hook.ts](/Users/bhaskarpandit/Documents/ideal-no/server/src/providers/file/hooks/codex-hook.ts).
- Before adding new product behavior, check whether it should map to roadmap entities and flows from [plans/2026-04-15-multi-agent-control-roadmap.md](/Users/bhaskarpandit/Documents/ideal-no/plans/2026-04-15-multi-agent-control-roadmap.md).
- Do not default to opening terminals as the primary interaction when inspection or control would be a better mission-control behavior.
- Preserve provider-agnostic naming and abstractions where they already exist. Do not reintroduce Claude-specific assumptions into new code.
- Keep this file aligned with the current codebase. If the implementation changes, update this file instead of leaning on historical references.
