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

  constructor(private readonly outputChannel: vscode.OutputChannel) {
    const config = vscode.workspace.getConfiguration('pixelAgents');
    this.port = config.get<number>('mcp.port', MCP_DEFAULT_PORT);
  }

  setCopilotDetector(detector: CopilotDetector): void {
    this.copilotDetector = detector;
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
        agent_name: z.string().describe('Display name for this agent in the office'),
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
        agent_name,
        tool_name,
        status,
      }: {
        agent_name: string;
        tool_name: string;
        status: string;
      }) => {
        if (this.copilotDetector) {
          this.copilotDetector.reportMcpActivity(agent_name, tool_name, status);
        }
        return {
          content: [{ type: 'text' as const, text: 'Activity reported.' }],
        };
      },
    );

    // ── report_idle: Agent reports it's done / waiting ───────────
    srv.tool(
      'report_idle',
      'Report that the agent has finished its current task and is idle or waiting. Call this when you complete a task or are waiting for input.',
      {
        agent_name: z.string().describe('Display name for this agent in the office'),
      },
      async ({ agent_name }: { agent_name: string }) => {
        if (this.copilotDetector) {
          this.copilotDetector.reportMcpIdle(agent_name);
        }
        return {
          content: [{ type: 'text' as const, text: 'Idle state reported.' }],
        };
      },
    );

    this.outputChannel.appendLine(
      '[MCP] Tools registered: ask_user, notify_user, report_activity, report_idle',
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

        transport.onclose = () => {
          sessions.delete(transport.sessionId);
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
