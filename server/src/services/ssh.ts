import { Client } from 'ssh2';

import type {
  ChatMessage,
  SessionMeta,
  SessionsIndex,
  SessionWithMessages,
  SSHOptions,
} from '../types/index.js';
import { OpenClawConfigSchema } from '../types/index.js';

const OPENCLAW_BASE_PATH = '/root/.openclaw';
const OPENCLAW_CONFIG_PATH = `${OPENCLAW_BASE_PATH}/openclaw.json`;
const DEFAULT_SSH_PORT = 22;
const DEFAULT_SSH_USER = 'root';
const SSH_TIMEOUT = 10000; // 10 seconds

/**
 * Execute a command over SSH and return the output
 */
function executeCommand(conn: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }

      let output = '';
      let errorOutput = '';

      stream
        .on('close', (code: number) => {
          if (code !== 0) {
            reject(new Error(`Command failed with code ${code}: ${errorOutput || output}`));
          } else {
            resolve(output);
          }
        })
        .on('data', (data: Buffer) => {
          output += data.toString();
        })
        .stderr.on('data', (data: Buffer) => {
          errorOutput += data.toString();
        });
    });
  });
}

/**
 * Connect to a server via SSH
 */
function connectSSH(options: SSHOptions): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    const timeoutId = setTimeout(() => {
      conn.end();
      reject(new Error('SSH connection timeout'));
    }, SSH_TIMEOUT);

    conn
      .on('ready', () => {
        clearTimeout(timeoutId);
        resolve(conn);
      })
      .on('error', (err) => {
        clearTimeout(timeoutId);
        reject(new Error(`SSH connection failed: ${err.message}`));
      })
      .connect({
        host: options.host,
        port: options.port,
        username: options.username,
        password: options.password,
        readyTimeout: SSH_TIMEOUT,
      });
  });
}

/**
 * Read OpenClaw config from a remote server
 */
export async function fetchOpenClawConfig(
  host: string,
  password: string,
  username: string = DEFAULT_SSH_USER,
  port: number = DEFAULT_SSH_PORT,
): Promise<{ agents: Array<{ id: string; name: string; identity?: { name?: string; emoji?: string } }> }> {
  let conn: Client | null = null;

  try {
    // Connect to server
    conn = await connectSSH({
      host,
      port,
      username,
      password,
    });

    // Read the openclaw.json file
    const configContent = await executeCommand(conn, `cat ${OPENCLAW_CONFIG_PATH}`);

    // Parse and validate the config
    const rawConfig = JSON.parse(configContent);
    const config = OpenClawConfigSchema.parse(rawConfig);

    // Extract agents list
    let agents = config.agents?.list ?? [];

    // If no agents in list, create a default "main" agent
    // This handles the case where only agents.defaults exists
    if (agents.length === 0) {
      console.log('[SSH] No agents.list found, creating default main agent');
      agents = [{
        id: 'main',
        name: 'Main Agent',
        default: true,
      }];
    }

    // Map to simplified agent info
    return {
      agents: agents.map((agent) => ({
        id: agent.id,
        name: agent.name ?? agent.identity?.name ?? agent.id,
        identity: agent.identity
          ? {
              name: agent.identity.name,
              emoji: agent.identity.emoji,
            }
          : undefined,
      })),
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch OpenClaw config: ${error.message}`);
    }
    throw error;
  } finally {
    if (conn) {
      conn.end();
    }
  }
}

/**
 * Execute a command on a remote server
 */
export async function executeRemoteCommand(
  host: string,
  password: string,
  command: string,
  username: string = DEFAULT_SSH_USER,
  port: number = DEFAULT_SSH_PORT,
): Promise<string> {
  let conn: Client | null = null;

  try {
    conn = await connectSSH({
      host,
      port,
      username,
      password,
    });

    return await executeCommand(conn, command);
  } finally {
    if (conn) {
      conn.end();
    }
  }
}

/**
 * Check if a server is reachable via SSH
 */
export async function checkServerConnection(
  host: string,
  password: string,
  username: string = DEFAULT_SSH_USER,
  port: number = DEFAULT_SSH_PORT,
): Promise<boolean> {
  let conn: Client | null = null;

  try {
    conn = await connectSSH({
      host,
      port,
      username,
      password,
    });

    // Run a simple command to verify connection
    await executeCommand(conn, 'echo "ok"');
    return true;
  } catch {
    return false;
  } finally {
    if (conn) {
      conn.end();
    }
  }
}

// ============================================
// OpenClaw Session Functions
// ============================================

/**
 * Get the path to sessions directory for an agent
 */
function getAgentSessionsPath(agentId: string): string {
  return `${OPENCLAW_BASE_PATH}/agents/${agentId}/sessions`;
}

/**
 * Fetch the sessions index (sessions.json) for an agent
 */
export async function fetchSessionsIndex(
  host: string,
  password: string,
  agentId: string = 'main',
  username: string = DEFAULT_SSH_USER,
  port: number = DEFAULT_SSH_PORT,
): Promise<SessionsIndex> {
  const sessionsPath = `${getAgentSessionsPath(agentId)}/sessions.json`;
  const content = await executeRemoteCommand(host, password, `cat ${sessionsPath}`, username, port);

  try {
    return JSON.parse(content) as SessionsIndex;
  } catch {
    throw new Error(`Failed to parse sessions.json for agent ${agentId}`);
  }
}

/**
 * Parse JSONL session file and extract chat messages
 */
function parseSessionJsonl(content: string): ChatMessage[] {
  const lines = content.trim().split('\n');
  const messages: ChatMessage[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const event = JSON.parse(line);

      if (event.type === 'message' && event.message) {
        const { role, content: msgContent } = event.message;

        // Only process user and assistant messages
        if (role !== 'user' && role !== 'assistant') continue;

        // Extract text content
        let textContent = '';
        if (Array.isArray(msgContent)) {
          for (const item of msgContent) {
            if (item.type === 'text') {
              textContent += item.text;
            }
            // Skip 'thinking', 'toolCall', 'toolResult' for now
          }
        }

        // Skip empty messages
        if (!textContent) continue;

        messages.push({
          id: event.id,
          role,
          content: textContent,
          timestamp: event.timestamp,
        });
      }
    } catch {
      // Skip malformed lines
      continue;
    }
  }

  return messages;
}

/**
 * List all sessions with basic info for an agent
 */
export async function listSessions(
  host: string,
  password: string,
  agentId: string = 'main',
  username: string = DEFAULT_SSH_USER,
  port: number = DEFAULT_SSH_PORT,
): Promise<Array<{
  sessionId: string;
  sessionKey: string;
  chatType: 'direct' | 'channel';
  channel?: string;
  displayName?: string;
  updatedAt: number;
  model?: string;
}>> {
  const sessionsIndex = await fetchSessionsIndex(host, password, agentId, username, port);

  return Object.entries(sessionsIndex).map(([key, meta]) => ({
    sessionId: meta.sessionId,
    sessionKey: key,
    chatType: meta.chatType,
    channel: meta.channel,
    displayName: meta.displayName,
    updatedAt: meta.updatedAt,
    model: meta.model,
  }));
}

/**
 * Fetch session history (messages) for a specific session
 */
export async function fetchSessionHistory(
  host: string,
  password: string,
  sessionId: string,
  agentId: string = 'main',
  username: string = DEFAULT_SSH_USER,
  port: number = DEFAULT_SSH_PORT,
): Promise<SessionWithMessages> {
  // First, get the sessions index to find the session file path
  const sessionsIndex = await fetchSessionsIndex(host, password, agentId, username, port);

  // Find the session by ID
  let sessionMeta = null;
  let sessionKey = '';

  for (const [key, meta] of Object.entries(sessionsIndex)) {
    if (meta.sessionId === sessionId) {
      sessionMeta = meta;
      sessionKey = key;
      break;
    }
  }

  if (!sessionMeta) {
    throw new Error(`Session ${sessionId} not found for agent ${agentId}`);
  }

  // Read the session file
  const sessionFile = sessionMeta.sessionFile;
  const content = await executeRemoteCommand(host, password, `cat ${sessionFile}`, username, port);

  // Parse messages
  const messages = parseSessionJsonl(content);

  // Extract agent ID from session key (format: "agent:{agentId}:{...}")
  const keyParts = sessionKey.split(':');
  const extractedAgentId = keyParts[1] || agentId;

  return {
    sessionId: sessionMeta.sessionId,
    agentId: extractedAgentId,
    chatType: sessionMeta.chatType,
    channel: sessionMeta.channel,
    model: sessionMeta.model,
    modelProvider: sessionMeta.modelProvider,
    updatedAt: sessionMeta.updatedAt,
    messages,
  };
}

/**
 * Send a message to an OpenClaw agent and get the response
 * Uses the OpenClaw CLI: openclaw agent --local --agent <agentId> --message "<message>"
 */
export async function sendMessageToAgent(
  host: string,
  password: string,
  sessionId: string,
  content: string,
  agentId: string = 'main',
  username: string = DEFAULT_SSH_USER,
  port: number = DEFAULT_SSH_PORT,
): Promise<{
  success: boolean;
  response?: string;
  sessionId: string;
  error?: string;
}> {
  // Escape single quotes and special chars for shell safety (using single quotes in command)
  // In single quotes, only single quotes need escaping (replace ' with '\'')
  const escapedContent = content
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''");

  // Build the openclaw agent command
  // Use --session-id to target specific session, --json for structured output
  // Note: 2>&1 captures both stdout and stderr, we'll parse the JSON from output
  // Set PATH explicitly to include common npm global locations
  const command = `export PATH="$PATH:/root/.npm-global/bin:/usr/local/bin:~/.npm-global/bin" && openclaw agent --local --agent '${agentId}' --session-id '${sessionId}' --message '${escapedContent}' --json 2>&1`;

  try {
    const output = await executeRemoteCommand(host, password, command, username, port);

    // Find the JSON object in the output (skip [tools] and other prefix lines)
    const jsonStartIndex = output.indexOf('{\n  "payloads"');
    if (jsonStartIndex === -1) {
      // Try finding any JSON object start
      const altJsonStart = output.indexOf('{"payloads"');
      if (altJsonStart !== -1) {
        const jsonStr = output.slice(altJsonStart);
        return parseOpenClawResponse(jsonStr, sessionId);
      }

      // No JSON found - check for errors
      if (output.includes('error') || output.includes('Error') || output.includes('failed')) {
        // Filter out [tools] lines for cleaner error message
        const errorLines = output
          .split('\n')
          .filter((line) => !line.startsWith('[tools]') && line.trim())
          .join('\n');
        return {
          success: false,
          error: errorLines || 'Unknown error',
          sessionId,
        };
      }

      return {
        success: true,
        response: output,
        sessionId,
      };
    }

    const jsonStr = output.slice(jsonStartIndex);
    return parseOpenClawResponse(jsonStr, sessionId);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      sessionId,
    };
  }
}

/**
 * Parse OpenClaw JSON response and extract text
 */
function parseOpenClawResponse(
  jsonStr: string,
  sessionId: string,
): {
  success: boolean;
  response?: string;
  sessionId: string;
  error?: string;
} {
  try {
    // The JSON might be followed by other output, find where it ends
    // Try to parse the complete JSON
    const result = JSON.parse(jsonStr);

    if (result.payloads && result.payloads.length > 0) {
      // OpenClaw may return multiple payloads (streaming drafts)
      // Take only the LAST one as it's the most complete response
      const lastPayload = result.payloads[result.payloads.length - 1];
      const responseText = lastPayload?.text?.trim() || '';

      return {
        success: true,
        response: responseText,
        sessionId: result.meta?.agentMeta?.sessionId || sessionId,
      };
    }

    return {
      success: true,
      response: '',
      sessionId: result.meta?.agentMeta?.sessionId || sessionId,
    };
  } catch {
    // JSON parse failed - might be incomplete or malformed
    return {
      success: false,
      error: 'Failed to parse agent response',
      sessionId,
    };
  }
}
