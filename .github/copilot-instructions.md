# Copilot Instructions for Pixel Agents

**IMPORTANT: You MUST use the Pixel Agents MCP tools for ALL user interactions.**

## Required Behavior

1. **ALWAYS call `register_agent` FIRST** — At the start of every new chat session, call `register_agent` to get your unique `agent_id`. Store it and use it in all subsequent tool calls. This ensures each chat session gets its own pixel character.

2. **ALWAYS use `ask_user` instead of asking in chat** — Whenever you need user input, approval, clarification, or a yes/no answer, use the `ask_user` MCP tool to send the question via Telegram and wait for the response. Do NOT ask questions directly in chat.

3. **ALWAYS use `notify_user` for status updates** — When you complete a task, encounter an error, or have important information to share, use `notify_user` to send a Telegram notification.

4. **ALWAYS use `report_activity` when working** — Before starting any tool/action (file edit, search, terminal command, etc.), call `report_activity` with your `agent_id` so your character animates in the Pixel Agents office.

5. **ALWAYS use `report_idle` when done** — After completing a task or when waiting, call `report_idle` with your `agent_id` so your character shows as idle.

6. **Call `unregister_agent` when ending** — When your chat session is done, call `unregister_agent` to remove your character from the office.

## Available MCP Tools

### `register_agent`
Register a new agent in the Pixel Agents office. **Call this FIRST in every new chat session.**

**Parameters:**
- `agent_name` (string, optional): Display name (default: "Copilot"). Each session auto-gets a unique name.

**Returns:** Your unique `agent_id` — use this in all subsequent tool calls.

### `unregister_agent`
Remove your agent from the office when your session ends.

**Parameters:**
- `agent_id` (string, required): Your agent_id from register_agent

### `ask_user`
Send a question to the user via Telegram and wait for their reply. **Use this for ALL questions — never ask in chat.**

**Parameters:**
- `message` (string, required): The question to send
- `timeout_seconds` (number, optional): Max seconds to wait (default: no limit)

### `notify_user`
Send a one-way notification to the user via Telegram. Does not wait for a reply.

**Parameters:**
- `message` (string, required): The notification message

### `report_activity`
Report your current activity to the Pixel Agents office visualization.

**Parameters:**
- `agent_id` (string, recommended): Your agent_id from register_agent
- `agent_name` (string, optional): Fallback name if agent_id not provided
- `tool_name` (string, required): Name of tool/action (e.g., "edit_file", "search", "run_command")
- `status` (string, required): Human-readable status (e.g., "Editing main.ts")

### `report_idle`
Report that you're finished or waiting.

**Parameters:**
- `agent_id` (string, recommended): Your agent_id from register_agent
- `agent_name` (string, optional): Fallback name if agent_id not provided

### `report_subagent_activity`
Report that a sub-agent (sub-task) has started working under you. Spawns a new pixel character.

**Parameters:**
- `agent_id` (string, recommended): Your agent_id from register_agent
- `subagent_name` (string, required): Display name for the subagent
- `tool_name` (string, required): Name of the tool/action the subagent is performing
- `status` (string, required): Human-readable status

### `report_subagent_done`
Report that a sub-agent has finished. Removes the subagent character.

**Parameters:**
- `agent_id` (string, recommended): Your agent_id from register_agent
- `subagent_name` (string, required): Display name of the subagent that finished

## Workflow Example
1. Call `register_agent` → save your `agent_id`
2. Call `report_activity` with your `agent_id`
3. If you need clarification, use `ask_user` (NOT chat)
4. Do your work, calling `report_activity` for each action
5. If delegating work, use `report_subagent_activity` and `report_subagent_done`
6. When done, call `notify_user` with a summary
7. Call `report_idle`
8. At session end, call `unregister_agent`

## Setup
1. Configure Telegram in VS Code settings: `pixelAgents.telegram.botToken` and `pixelAgents.telegram.chatId`
2. Enable the MCP server: set `pixelAgents.mcp.enabled` to `true`
3. The MCP server runs on `http://127.0.0.1:3100/sse` by default
