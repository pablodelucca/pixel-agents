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
 * Find the openclaw CLI path on remote server
 */
async function findOpenClawPath(
  host: string,
  password: string,
  username: string = DEFAULT_SSH_USER,
  port: number = DEFAULT_SSH_PORT,
): Promise<{ command: string; error?: string }> {
  // Try common locations
  const possiblePaths = [
    'openclaw', // In PATH
    '/usr/local/bin/openclaw',
    '/root/.npm-global/bin/openclaw',
    '/usr/bin/openclaw',
    '/home/.npm-global/bin/openclaw',
    '/usr/local/node/bin/openclaw',
  ];

  // Common npx locations
  const npxPaths = [
    '/usr/local/bin/npx',
    '/usr/bin/npx',
    '/root/.npm-global/bin/npx',
    '/usr/local/node/bin/npx',
  ];

  let conn: Client | null = null;
  try {
    conn = await connectSSH({ host, port, username, password });

    // First, source profile and try to find the CLI
    const sourceProfile = 'source ~/.bashrc ~/.profile ~/.bash_profile 2>/dev/null || true';
    
    // Try which command first with profile sourced
    try {
      const whichResult = await executeCommand(conn, `${sourceProfile} && which openclaw 2>/dev/null || command -v openclaw 2>/dev/null`);
      const path = whichResult.trim();
      if (path && path.startsWith('/')) {
        console.log('[SSH] Found openclaw at:', path);
        return { command: path };
      }
    } catch {
      // Continue to check other paths
    }

    // Check each possible path
    for (const path of possiblePaths) {
      if (path === 'openclaw') continue; // Skip bare command
      try {
        await executeCommand(conn, `test -x ${path}`);
        console.log('[SSH] Found openclaw at:', path);
        return { command: path };
      } catch {
        continue;
      }
    }

    // Check if npx is available in common locations
    for (const npxPath of npxPaths) {
      try {
        await executeCommand(conn, `test -x ${npxPath}`);
        console.log('[SSH] openclaw not found, will use npx at:', npxPath);
        return { command: `${npxPath} -y openclaw` };
      } catch {
        continue;
      }
    }

    // Last resort: try to find node/npx with extended search
    try {
      const findNode = await executeCommand(conn, `find /usr -name "npx" -type f 2>/dev/null | head -1`);
      const npxPath = findNode.trim();
      if (npxPath) {
        console.log('[SSH] Found npx at:', npxPath);
        return { command: `${npxPath} -y openclaw` };
      }
    } catch {
      // Not found
    }

    // Nothing found
    console.log('[SSH] openclaw and npx not found');
    return { 
      command: 'openclaw', 
      error: 'OpenClaw CLI not found on server. Please ensure OpenClaw is installed and accessible in PATH.' 
    };
  } finally {
    if (conn) conn.end();
  }
}

// Cache for openclaw path per host
const openclawPathCache = new Map<string, { command: string; error?: string }>();

/**
 * Get openclaw path (cached or discover)
 */
async function getOpenClawPath(
  host: string,
  password: string,
  username: string = DEFAULT_SSH_USER,
  port: number = DEFAULT_SSH_PORT,
): Promise<{ command: string; error?: string }> {
  const cacheKey = `${username}@${host}:${port}`;
  
  if (openclawPathCache.has(cacheKey)) {
    return openclawPathCache.get(cacheKey)!;
  }

  const result = await findOpenClawPath(host, password, username, port);
  openclawPathCache.set(cacheKey, result);
  return result;
}

/**
 * Send a message to an OpenClaw agent and get the response
 * Uses the OpenClaw CLI: openclaw agent --local --agent <agentId> --message "<message>"
 * 
 * This approach runs the openclaw CLI directly on the client VPS via SSH,
 * so the gateway remains loopback-only and is never exposed to the public.
 * The SSH connection is short-lived (per-request), making it scalable.
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

  try {
    // Get the correct openclaw path
    const openclawResult = await getOpenClawPath(host, password, username, port);
    
    // If we already know there's an error, return early
    if (openclawResult.error) {
      return {
        success: false,
        error: openclawResult.error,
        sessionId,
      };
    }
    
    // Build the openclaw agent command
    // Use --session-id to target specific session, --json for structured output
    // Note: 2>&1 captures both stdout and stderr, we'll parse the JSON from output
    // Source profile to ensure PATH includes node/npm locations
    const sourceProfile = 'source ~/.bashrc ~/.profile ~/.bash_profile 2>/dev/null || true';
    const command = `${sourceProfile} && ${openclawResult.command} agent --local --agent '${agentId}' --session-id '${sessionId}' --message '${escapedContent}' --json 2>&1`;

    console.log('[SSH] Executing command on', host);
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
      if (output.includes('error') || output.includes('Error') || output.includes('failed') || output.includes('not found')) {
        // Filter out [tools] lines for cleaner error message
        const errorLines = output
          .split('\n')
          .filter((line) => !line.startsWith('[tools]') && line.trim())
          .join('\n');
        
        // Check for CLI not found specifically
        if (output.includes('command not found') || output.includes('not found')) {
          // Clear cache so we retry discovery next time
          const cacheKey = `${username}@${host}:${port}`;
          openclawPathCache.delete(cacheKey);
          return {
            success: false,
            error: 'OpenClaw CLI not found on server. Please ensure OpenClaw is installed correctly.',
            sessionId,
          };
        }
        
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

/**
 * Fetch agent workspace files from ~/.openclaw/workspace/
 * Returns the 7 markdown files that define the agent's personality and memory
 */
export async function fetchAgentWorkspace(
  host: string,
  password: string,
  agentId: string = 'main',
  username: string = DEFAULT_SSH_USER,
  port: number = DEFAULT_SSH_PORT,
): Promise<{
  success: boolean;
  files?: Record<string, string>;
  error?: string;
}> {
  const workspacePath = `${OPENCLAW_BASE_PATH}/workspace`;
  
  // The 7 files that define an agent
  const filesToFetch = [
    'AGENTS.md',
    'HEARTBEAT.md',
    'IDENTITY.md',
    'MEMORY.md',
    'SOUL.md',
    'TOOLS.md',
    'USER.md',
  ];

  let conn: Client | null = null;

  try {
    // Connect once for all files
    conn = await connectSSH({ host, port, username, password });
    
    const files: Record<string, string> = {};

    for (const filename of filesToFetch) {
      const filePath = `${workspacePath}/${filename}`;
      try {
        const content = await executeCommand(conn, `cat ${filePath} 2>/dev/null || echo ""`);
        files[filename] = content.trim();
      } catch {
        // File doesn't exist or can't be read - use empty string
        files[filename] = '';
      }
    }

    return {
      success: true,
      files,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    // Always close the connection
    if (conn) {
      conn.end();
    }
  }
}

/**
 * Create a new session for an agent
 * Sends an initial message to create the session, then returns the session info
 */
export async function createNewSession(
  host: string,
  password: string,
  agentId: string = 'main',
  initialMessage: string = 'Hello',
  username: string = DEFAULT_SSH_USER,
  port: number = DEFAULT_SSH_PORT,
): Promise<{
  success: boolean;
  sessionId?: string;
  response?: string;
  error?: string;
}> {
  // Escape single quotes and special chars for shell safety
  const escapedContent = initialMessage
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''");

  try {
    // Get the correct openclaw path
    const openclawResult = await getOpenClawPath(host, password, username, port);
    
    // If we already know there's an error, return early
    if (openclawResult.error) {
      return {
        success: false,
        error: openclawResult.error,
      };
    }
    
    // Build the openclaw agent command WITHOUT session-id to create new session
    const sourceProfile = 'source ~/.bashrc ~/.profile ~/.bash_profile 2>/dev/null || true';
    const command = `${sourceProfile} && ${openclawResult.command} agent --local --agent '${agentId}' --message '${escapedContent}' --json 2>&1`;

    console.log('[SSH] Creating new session on', host, 'for agent', agentId);
    const output = await executeRemoteCommand(host, password, command, username, port);

    // Find the JSON object in the output
    const jsonStartIndex = output.indexOf('{\n  "payloads"');
    if (jsonStartIndex === -1) {
      const altJsonStart = output.indexOf('{"payloads"');
      if (altJsonStart !== -1) {
        const jsonStr = output.slice(altJsonStart);
        return parseOpenClawResponse(jsonStr, '');
      }

      // No JSON found - check for errors
      if (output.includes('error') || output.includes('Error') || output.includes('failed') || output.includes('not found')) {
        const errorLines = output
          .split('\n')
          .filter((line) => !line.startsWith('[tools]') && line.trim())
          .join('\n');
        
        if (output.includes('command not found') || output.includes('not found')) {
          const cacheKey = `${username}@${host}:${port}`;
          openclawPathCache.delete(cacheKey);
          return {
            success: false,
            error: 'OpenClaw CLI not found on server. Please ensure OpenClaw is installed correctly.',
          };
        }
        
        return {
          success: false,
          error: errorLines || 'Unknown error',
        };
      }

      return {
        success: true,
        response: output,
      };
    }

    const jsonStr = output.slice(jsonStartIndex);
    return parseOpenClawResponse(jsonStr, '');
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
