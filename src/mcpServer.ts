import * as http from 'http';
import * as vscode from 'vscode';
import { z } from 'zod';

import { MCP_DEFAULT_PORT, MCP_SERVER_NAME, MCP_SERVER_VERSION } from './constants.js';
import type { CopilotDetector } from './copilotDetector.js';
import { removeMcpConfig, writeMcpConfig } from './mcpConfig.js';
import { TelegramBot } from './telegramBot.js';

// Use `any` for the MCP server instance because the SDK has dual CJS/ESM type declarations
// that cause assignment issues under Node16 module resolution.

type McpServerInstance = any;

/**
 * MCP Server embedded in the VS Code extension.
 *
 * Provides tools that GitHub Copilot (or any MCP client) can invoke:
 * - ask_user: Send a question to Telegram and wait for a reply
 * - notify_user: Send a one-way notification to Telegram
 * - report_activity: Report agent activity to the pixel office visualization
 * - report_idle: Report agent is idle/waiting
 *
 * Transport: Streamable HTTP on a configurable port.
 */
export class PixelAgentsMcpServer implements vscode.Disposable {
  private server: McpServerInstance | null = null;
  private httpServer: http.Server | null = null;
  private telegramBot: TelegramBot | null = null;
  private copilotDetector: CopilotDetector | null = null;
  private port: number;

  // Agent registration: each register_agent call creates a unique agent
  private registeredAgents = new Map<string, string>(); // agentId → agentName
  private nextRegisteredId = 1;

  // Callback when a new agent registers
  onAgentRegistered?: (agentId: string, agentName: string) => void;
  // Callback when an agent unregisters
  onAgentUnregistered?: (agentId: string, agentName: string) => void;

  // Callbacks for subagent events (set by extension.ts)
  onSubagentActivity?: (
    parentId: number,
    toolId: string,
    subagentName: string,
    toolName: string,
    status: string,
  ) => void;
  onSubagentDone?: (parentId: number, toolId: string) => void;

  constructor(private readonly outputChannel: vscode.OutputChannel) {
    const config = vscode.workspace.getConfiguration('pixelAgents');
    this.port = config.get<number>('mcp.port', MCP_DEFAULT_PORT);
  }

  setCopilotDetector(detector: CopilotDetector): void {
    this.copilotDetector = detector;
  }

  /**
   * Resolve the effective agent name from an agent_id.
   * If agent_id is provided and registered, use that agent's name.
   * Otherwise, fall back to the provided agent_name.
   */
  private resolveAgentName(agentId?: string, fallbackName?: string): string {
    if (agentId && this.registeredAgents.has(agentId)) {
      return this.registeredAgents.get(agentId)!;
    }
    return fallbackName || 'Copilot';
  }

  async start(): Promise<void> {
    this.refreshTelegramBot();

    // Dynamic imports for the MCP SDK (ESM-compatible)
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');

    this.server = new McpServer(
      { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      { capabilities: { logging: {} } },
    );

    this.registerTools();
    await this.startHttpTransport();

    this.outputChannel.appendLine(`[MCP] Server started on port ${this.port}`);
    vscode.window.showInformationMessage(`Pixel Agents MCP server running on port ${this.port}`);

    // Write MCP config for CLI discovery
    writeMcpConfig(this.port);
  }

  /**
   * Refresh the Telegram bot instance from current VS Code settings.
   * Called at start and before each Telegram tool call to pick up config changes.
   */
  private refreshTelegramBot(): TelegramBot | null {
    const config = vscode.workspace.getConfiguration('pixelAgents');
    const botToken = config.get<string>('telegram.botToken', '');
    const chatId = config.get<string>('telegram.chatId', '');

    if (botToken && chatId) {
      // Only recreate if settings changed
      if (!this.telegramBot) {
        this.telegramBot = new TelegramBot(botToken, chatId);
        this.outputChannel.appendLine('[MCP] Telegram bot configured');
      }
      return this.telegramBot;
    }

    this.outputChannel.appendLine('[MCP] Telegram not configured — bot token or chat ID missing');
    return null;
  }

  private registerTools(): void {
    if (!this.server) return;
    const srv = this.server;

    // ── register_agent: Create a new unique agent ────────────────
    srv.tool(
      'register_agent',
      'Register a new agent in the Pixel Agents office. Call this FIRST before any other reporting tools. Returns your unique agent_id that you must use in all subsequent tool calls. Each chat session should register its own agent.',
      {
        agent_name: z
          .string()
          .optional()
          .describe('Display name for this agent (default: "Copilot")'),
      },
      async ({ agent_name }: { agent_name?: string }) => {
        const baseName = agent_name || 'Copilot';
        const agentId = `agent-${this.nextRegisteredId++}`;

        // Generate unique display name
        const usedNames = new Set(this.registeredAgents.values());
        let displayName = baseName;
        if (usedNames.has(displayName)) {
          let counter = 2;
          while (usedNames.has(`${baseName} #${counter}`)) counter++;
          displayName = `${baseName} #${counter}`;
        }

        this.registeredAgents.set(agentId, displayName);
        this.outputChannel.appendLine(`[MCP] Agent registered: ${agentId} → "${displayName}"`);

        // Create the agent character in the office
        if (this.copilotDetector) {
          this.copilotDetector.reportMcpActivity(displayName, 'register', 'Joining office');
        }
        this.onAgentRegistered?.(agentId, displayName);

        return {
          content: [
            {
              type: 'text' as const,
              text: `Agent registered. Your agent_id is "${agentId}" and display name is "${displayName}". Use this agent_id in all subsequent tool calls.`,
            },
          ],
        };
      },
    );

    // ── unregister_agent: Remove an agent ────────────────────────
    srv.tool(
      'unregister_agent',
      'Unregister an agent from the Pixel Agents office. Call this when your chat session is ending.',
      {
        agent_id: z.string().describe('Your agent_id from register_agent'),
      },
      async ({ agent_id }: { agent_id: string }) => {
        const name = this.registeredAgents.get(agent_id);
        if (!name) {
          return {
            content: [{ type: 'text' as const, text: 'Unknown agent_id.' }],
            isError: true,
          };
        }
        this.registeredAgents.delete(agent_id);
        if (this.copilotDetector) {
          this.copilotDetector.reportMcpIdle(name);
        }
        this.onAgentUnregistered?.(agent_id, name);
        return {
          content: [{ type: 'text' as const, text: 'Agent unregistered.' }],
        };
      },
    );

    // ── ask_user: Send question to Telegram, wait for reply ──────
    srv.tool(
      'ask_user',
      'Send a question to the user via Telegram and wait for their reply. Use this when you need user input or approval.',
      {
        message: z.string().describe('The question or message to send to the user'),
        timeout_seconds: z
          .number()
          .optional()
          .describe('Max seconds to wait for reply (0 or omit for no limit)'),
      },
      async ({ message, timeout_seconds }: { message: string; timeout_seconds?: number }) => {
        // Refresh bot from settings on each call to pick up config changes
        const bot = this.refreshTelegramBot();
        if (!bot) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: Telegram bot not configured. Set pixelAgents.telegram.botToken and pixelAgents.telegram.chatId in VS Code settings.',
              },
            ],
            isError: true,
          };
        }
        try {
          const timeoutMs = timeout_seconds ? timeout_seconds * 1000 : 0;
          const reply = await bot.askUser(message, timeoutMs);
          return {
            content: [{ type: 'text' as const, text: reply }],
          };
        } catch (e) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    // ── notify_user: One-way notification to Telegram ────────────
    srv.tool(
      'notify_user',
      'Send a one-way notification to the user via Telegram. Does not wait for a reply.',
      {
        message: z.string().describe('The notification message to send'),
      },
      async ({ message }: { message: string }) => {
        const bot = this.refreshTelegramBot();
        if (!bot) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: Telegram bot not configured.',
              },
            ],
            isError: true,
          };
        }
        try {
          await bot.notifyUser(message);
          return {
            content: [{ type: 'text' as const, text: 'Notification sent successfully.' }],
          };
        } catch (e) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    // ── report_activity: Agent reports what it's doing ───────────
    srv.tool(
      'report_activity',
      'Report current agent activity to the Pixel Agents office visualization. Call this when starting a new tool/action so the user can see your character animate.',
      {
        agent_id: z
          .string()
          .optional()
          .describe('Your agent_id from register_agent (recommended for multi-agent support)'),
        agent_name: z
          .string()
          .optional()
          .describe('Display name for this agent (fallback if agent_id not provided)'),
        tool_name: z
          .string()
          .describe(
            'Name of the tool/action being performed (e.g., "edit_file", "search", "run_command")',
          ),
        status: z
          .string()
          .describe(
            'Human-readable status text (e.g., "Editing main.ts", "Searching for references")',
          ),
      },
      async ({
        agent_id,
        agent_name,
        tool_name,
        status,
      }: {
        agent_id?: string;
        agent_name?: string;
        tool_name: string;
        status: string;
      }) => {
        const effectiveName = this.resolveAgentName(agent_id, agent_name);
        if (this.copilotDetector) {
          this.copilotDetector.reportMcpActivity(effectiveName, tool_name, status);
        }
        return {
          content: [{ type: 'text' as const, text: `Activity reported as "${effectiveName}".` }],
        };
      },
    );

    // ── report_idle: Agent reports it's done / waiting ───────────
    srv.tool(
      'report_idle',
      'Report that the agent has finished its current task and is idle or waiting. Call this when you complete a task or are waiting for input.',
      {
        agent_id: z.string().optional().describe('Your agent_id from register_agent'),
        agent_name: z
          .string()
          .optional()
          .describe('Display name for this agent (fallback if agent_id not provided)'),
      },
      async ({ agent_id, agent_name }: { agent_id?: string; agent_name?: string }) => {
        const effectiveName = this.resolveAgentName(agent_id, agent_name);
        if (this.copilotDetector) {
          this.copilotDetector.reportMcpIdle(effectiveName);
        }
        return {
          content: [{ type: 'text' as const, text: 'Idle state reported.' }],
        };
      },
    );

    // ── report_subagent_activity: Spawn a subagent character ─────
    srv.tool(
      'report_subagent_activity',
      'Report that a sub-agent (sub-task) has started working under a parent agent. This spawns a new pixel character near the parent agent. Use this when you delegate work to a sub-agent or start a parallel task.',
      {
        agent_id: z.string().optional().describe('Your agent_id from register_agent'),
        parent_agent_name: z
          .string()
          .optional()
          .describe('Display name of the parent agent (fallback if agent_id not provided)'),
        subagent_name: z
          .string()
          .describe('Display name for the subagent (e.g., "Search Agent", "Test Runner")'),
        tool_name: z.string().describe('Name of the tool/action the subagent is performing'),
        status: z
          .string()
          .describe('Human-readable status (e.g., "Running tests", "Searching codebase")'),
      },
      async ({
        agent_id,
        parent_agent_name,
        subagent_name,
        tool_name,
        status,
      }: {
        agent_id?: string;
        parent_agent_name?: string;
        subagent_name: string;
        tool_name: string;
        status: string;
      }) => {
        const effectiveParent = this.resolveAgentName(agent_id, parent_agent_name);
        if (this.copilotDetector) {
          const result = this.copilotDetector.reportSubagentActivity(
            effectiveParent,
            subagent_name,
            tool_name,
            status,
          );
          if (result && this.onSubagentActivity) {
            this.onSubagentActivity(
              result.parentId,
              result.toolId,
              subagent_name,
              tool_name,
              status,
            );
          }
        }
        return {
          content: [{ type: 'text' as const, text: 'Subagent activity reported.' }],
        };
      },
    );

    // ── report_subagent_done: Remove a subagent character ────────
    srv.tool(
      'report_subagent_done',
      'Report that a sub-agent (sub-task) has finished its work. This removes the subagent pixel character from the office.',
      {
        agent_id: z.string().optional().describe('Your agent_id from register_agent'),
        parent_agent_name: z
          .string()
          .optional()
          .describe('Display name of the parent agent (fallback if agent_id not provided)'),
        subagent_name: z.string().describe('Display name of the subagent that finished'),
      },
      async ({
        agent_id,
        parent_agent_name,
        subagent_name,
      }: {
        agent_id?: string;
        parent_agent_name?: string;
        subagent_name: string;
      }) => {
        const effectiveParent = this.resolveAgentName(agent_id, parent_agent_name);
        if (this.copilotDetector) {
          const parentId = this.copilotDetector.getParentAgentId(effectiveParent);
          const toolId = `copilot-sub-${subagent_name}`;
          if (parentId !== null && this.onSubagentDone) {
            this.onSubagentDone(parentId, toolId);
          }
        }
        return {
          content: [{ type: 'text' as const, text: 'Subagent completion reported.' }],
        };
      },
    );

    this.outputChannel.appendLine(
      '[MCP] Tools registered: register_agent, unregister_agent, ask_user, notify_user, report_activity, report_idle, report_subagent_activity, report_subagent_done',
    );
  }

  private async startHttpTransport(): Promise<void> {
    if (!this.server) return;

    // Use the SSE transport for maximum compatibility with MCP clients
    const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');

    // Track active sessions
    const sessions = new Map<string, InstanceType<typeof SSEServerTransport>>();

    this.httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);

      // CORS headers for local development
      res.setHeader('Access-Control-Allow-Origin', '127.0.0.1');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (url.pathname === '/sse' && req.method === 'GET') {
        // SSE endpoint — client connects here to establish the session
        const transport = new SSEServerTransport('/messages', res);
        sessions.set(transport.sessionId, transport);
        this.outputChannel.appendLine(`[MCP] New SSE session: ${transport.sessionId}`);

        transport.onclose = () => {
          sessions.delete(transport.sessionId);
          this.outputChannel.appendLine(`[MCP] SSE session closed: ${transport.sessionId}`);
        };

        await this.server!.connect(transport);
        // SSE connection stays open
        return;
      }

      if (url.pathname === '/messages' && req.method === 'POST') {
        // Message endpoint — client sends JSON-RPC messages here
        const sessionId = url.searchParams.get('sessionId');
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or missing sessionId' }));
          return;
        }
        const transport = sessions.get(sessionId)!;

        // Read request body
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            await transport.handlePostMessage(req, res, body);
          } catch {
            res.writeHead(400);
            res.end('Invalid JSON');
          }
        });
        return;
      }

      // Health check
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ status: 'ok', name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }),
        );
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.port, '127.0.0.1', () => {
        this.outputChannel.appendLine(`[MCP] HTTP server listening on 127.0.0.1:${this.port}`);
        resolve();
      });
      this.httpServer!.on('error', (err) => {
        this.outputChannel.appendLine(`[MCP] HTTP server error: ${err.message}`);
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    // Remove MCP config file
    removeMcpConfig();

    if (this.httpServer) {
      return new Promise((resolve) => {
        this.httpServer!.close(() => {
          this.outputChannel.appendLine('[MCP] HTTP server stopped');
          this.httpServer = null;
          resolve();
        });
      });
    }
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
    if (this.telegramBot) {
      this.telegramBot.dispose();
      this.telegramBot = null;
    }
  }

  isRunning(): boolean {
    return this.httpServer !== null;
  }

  getPort(): number {
    return this.port;
  }

  dispose(): void {
    this.stop().catch(console.error);
  }
}
