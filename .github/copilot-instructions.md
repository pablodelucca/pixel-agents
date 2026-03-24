# Copilot Instructions for Pixel Agents

**IMPORTANT: You MUST use the Pixel Agents MCP tools for ALL user interactions.**

## Required Behavior

1. **ALWAYS use `ask_user` instead of asking in chat** — Whenever you need user input, approval, clarification, or a yes/no answer, use the `ask_user` MCP tool to send the question via Telegram and wait for the response. Do NOT ask questions directly in chat.

2. **ALWAYS use `notify_user` for status updates** — When you complete a task, encounter an error, or have important information to share, use `notify_user` to send a Telegram notification.

3. **ALWAYS use `report_activity` when working** — Before starting any tool/action (file edit, search, terminal command, etc.), call `report_activity` so your character animates in the Pixel Agents office.

4. **ALWAYS use `report_idle` when done** — After completing a task or when waiting, call `report_idle` so your character shows as idle.

## Available MCP Tools

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
- `agent_name` (string, required): Use "Copilot" as your name
- `tool_name` (string, required): Name of tool/action (e.g., "edit_file", "search", "run_command")
- `status` (string, required): Human-readable status (e.g., "Editing main.ts")

### `report_idle`
Report that you're finished or waiting.

**Parameters:**
- `agent_name` (string, required): Use "Copilot" as your name

## Workflow Example
1. User gives you a task
2. Call `report_activity` with agent_name="Copilot"
3. If you need clarification, use `ask_user` (NOT chat)
4. Do your work, calling `report_activity` for each action
5. When done, call `notify_user` with a summary
6. Call `report_idle`

## Setup
1. Configure Telegram in VS Code settings: `pixelAgents.telegram.botToken` and `pixelAgents.telegram.chatId`
2. Enable the MCP server: set `pixelAgents.mcp.enabled` to `true`
3. The MCP server runs on `http://127.0.0.1:3100/sse` by default
