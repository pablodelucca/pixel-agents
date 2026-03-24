# Pixel Agents — GitHub Copilot Integration Setup Guide

This guide walks you through setting up the Pixel Agents extension with GitHub Copilot support, including the MCP server for agent communication and Telegram for remote interaction.

---

## Prerequisites

- **VS Code** 1.105.0 or later
- **GitHub Copilot** extension installed and active
- **Node.js** 18+ (for building from source)
- A **Telegram Bot** (for ask_user / notify_user — optional but recommended)

---

## 1. Install the Extension

### From Source (this repo)

```bash
cd pixel-agents
npm install
cd webview-ui && npm install && cd ..
npm run build
```

Then press `F5` in VS Code to launch the Extension Development Host with the extension loaded.

### From VSIX

If you have a packaged `.vsix` file:

```bash
code --install-extension pixel-agents-1.1.1.vsix
```

---

## 2. Configure VS Code Settings

Open **Settings** (`Ctrl+,`) and search for `pixelAgents`, or add these to your `settings.json`:

```jsonc
{
  // Agent mode: "claude", "copilot", or "both"
  "pixelAgents.agentMode": "copilot",

  // Enable the MCP server (required for Copilot integration)
  "pixelAgents.mcp.enabled": true,

  // MCP server port (default: 3100)
  "pixelAgents.mcp.port": 3100,

  // Telegram bot token (from @BotFather)
  "pixelAgents.telegram.botToken": "YOUR_BOT_TOKEN",

  // Telegram chat ID (your personal chat or group)
  "pixelAgents.telegram.chatId": "YOUR_CHAT_ID"
}
```

### Setting Descriptions

| Setting | Default | Description |
|---------|---------|-------------|
| `pixelAgents.agentMode` | `"both"` | Which agent backend to monitor: `claude`, `copilot`, or `both` |
| `pixelAgents.mcp.enabled` | `false` | Enable the built-in MCP server |
| `pixelAgents.mcp.port` | `3100` | Port for the MCP SSE server |
| `pixelAgents.telegram.botToken` | `""` | Telegram bot token for ask_user/notify_user tools |
| `pixelAgents.telegram.chatId` | `""` | Telegram chat ID for message routing |

---

## 3. Set Up a Telegram Bot

The Telegram bot enables the `ask_user` (send question → wait for reply) and `notify_user` (one-way notification) MCP tools.

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to create your bot
3. Copy the **bot token** (looks like `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)
4. Start a chat with your bot (send it any message)
5. Get your **chat ID**:
   - Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser
   - Find `"chat":{"id": 123456789}` in the response — that number is your chat ID
6. Paste the token and chat ID into your VS Code settings

---

## 4. Start the MCP Server

The MCP server starts automatically if `pixelAgents.mcp.enabled` is `true`.

You can also start/stop it manually via the Command Palette (`Ctrl+Shift+P`):

- **Pixel Agents: Start MCP Server**
- **Pixel Agents: Stop MCP Server**

The server runs at `http://127.0.0.1:3100/sse` by default and is auto-discovered by VS Code Copilot through the `mcpServerDefinitionProviders` API.

### Image Support

The `ask_user` and `notify_user` tools support sending images via Telegram:

- **Sending images**: Pass an `image_url` parameter (HTTP URL) alongside the message. Telegram will fetch and display the image.
- **Receiving images**: When a user replies to `ask_user` with a photo, the response includes the image as a base64-encoded MCP image content block, plus any caption as text.

---

## 5. Set Up the KaguraBot Agent File

The agent file tells Copilot how to use the Pixel Agents MCP tools and Telegram for communication.

### Create the agent file

1. In VS Code, open the Command Palette (`Ctrl+Shift+P`)
2. Type **"Preferences: Open User Prompts Folder"** and press Enter
3. Create a new file called `KaguraBot.agent.md`
4. Paste the content from the template (see below)

### Agent file location

The file lives at:
- **Windows**: `%APPDATA%\Code\User\prompts\KaguraBot.agent.md`
- **macOS**: `~/Library/Application Support/Code/User/prompts/KaguraBot.agent.md`
- **Linux**: `~/.config/Code/User/prompts/KaguraBot.agent.md`

### Template

```markdown
---
name: KaguraBot
description: "Use when: coding tasks requiring Pixel Agents MCP integration, Telegram-based user interaction, and office visualization."
argument-hint: A task to implement or a question to answer
tools: [vscode, execute, read, agent, edit, search, web, todo, pixel-agents/*]
---

### Pixel Agents Tool Instructions

1. At the START of every session, call `register_agent` to get your unique `agent_id`.
2. Before starting any tool/action, call `report_activity` with your `agent_id`.
3. When finished or waiting, call `report_idle` with your `agent_id`.
4. If delegating sub-tasks, use `report_subagent_activity` / `report_subagent_done`.
5. At session end, call `unregister_agent` to remove your character.

### TaskSync Tool Instructions

1. During any process, task, or conversation, you must call the `ask_user` tool to request feedback.
2. Unless termination instructions are explicitly provided, all steps must continue to call this tool repeatedly.
3. Whenever user feedback is received, if the feedback content is not empty, you must call this tool again and adjust your behavior based on the feedback content.
4. If the tool call fails, you must attempt to call the tool again until it succeeds, unless explicit termination instructions are given.
5. Only when the user explicitly indicates "end" or "no more interaction needed" can you stop calling this tool.

### Notification Instructions

1. When you complete a task, encounter an error, or have important information to share, use `notify_user` to send a Telegram notification.
2. Use `notify_user` for status updates — do NOT rely on chat messages alone.
```

> **Note**: The `tools` list in the frontmatter must include `pixel-agents/*` (matching your MCP server name). If the tools aren't showing up, check the MCP server name in the Output panel (`Pixel Agents` channel) and adjust accordingly.

---

## 6. Using KaguraBot

1. Open the Copilot chat panel in VS Code (`Ctrl+Shift+I` or click the chat icon)
2. In the chat input, type `@KaguraBot` followed by your request
3. KaguraBot will:
   - Register itself as an agent (you'll see a pixel character appear in the office)
   - Report activity as it works
   - Send questions to your Telegram via `ask_user`
   - Send status notifications via `notify_user`
   - Keep the ask_user loop active until you say "end"

---

## 7. Verify Everything Works

### Check the MCP server is running
1. Open the Output panel (`Ctrl+Shift+U`)
2. Select "Pixel Agents" from the dropdown
3. Look for: `[MCP] Server started on port 3100`

### Check Copilot sees the MCP tools
1. Open Copilot chat
2. Type `@KaguraBot test` — it should call `register_agent` first
3. Check the Output panel for: `[MCP] Agent registered: ...`

### Check Telegram is connected
1. After KaguraBot registers, it should call `ask_user` with a question
2. You should receive a Telegram message from your bot
3. Reply in Telegram — the response should reach KaguraBot

---

## Troubleshooting

### MCP server won't start
- Check the Output panel for errors
- Make sure port 3100 isn't already in use: `lsof -i :3100`
- Try a different port in settings

### Copilot doesn't see the MCP tools
- Ensure `pixelAgents.mcp.enabled` is `true`
- Restart VS Code after changing MCP settings
- Check that your VS Code version supports `mcpServerDefinitionProviders` (1.99+)
- Look in the Output panel for: `MCP server definition registered at http://127.0.0.1:3100/sse`

### Telegram messages not arriving
- Verify your bot token by visiting `https://api.telegram.org/bot<TOKEN>/getMe`
- Verify chat ID by sending a message to the bot then checking `/getUpdates`
- Make sure you started a conversation with the bot first (send it any message)

### Agent not appearing in the office
- Open the Pixel Agents panel (Command Palette → "Pixel Agents: Show Panel")
- Make sure `pixelAgents.agentMode` is set to `"copilot"` or `"both"`
- Check the Output panel for registration logs

### Tools listed as "pixel-agents/*" not found
- The MCP server name used in the tool prefix must match. Check the Output panel for the exact server name.
- You may need to use explicit tool names in the frontmatter instead of wildcards (e.g., `pixel-agents/ask_user, pixel-agents/notify_user, ...`)
