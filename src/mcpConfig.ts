import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { MCP_DEFAULT_PORT, MCP_SERVER_NAME } from './constants.js';

/**
 * Generates an MCP server configuration file that GitHub Copilot CLI
 * (and other MCP clients) can use to discover and connect to our server.
 *
 * The config is written to ~/.pixel-agents/mcp.json in the standard
 * MCP server configuration format.
 */

interface McpServerConfig {
  mcpServers: Record<
    string,
    {
      url?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
}

/**
 * Write the MCP server discovery config so CLI clients can find us.
 */
export function writeMcpConfig(port: number): void {
  const configDir = path.join(os.homedir(), '.pixel-agents');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const config: McpServerConfig = {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        url: `http://127.0.0.1:${port}/sse`,
      },
    },
  };

  const configPath = path.join(configDir, 'mcp.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`[Pixel Agents] MCP config written to ${configPath}`);
}

/**
 * Read the MCP configuration file.
 */
export function readMcpConfig(): McpServerConfig | null {
  const configPath = path.join(os.homedir(), '.pixel-agents', 'mcp.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as McpServerConfig;
  } catch {
    return null;
  }
}

/**
 * Remove the MCP config file (on server stop).
 */
export function removeMcpConfig(): void {
  const configPath = path.join(os.homedir(), '.pixel-agents', 'mcp.json');
  try {
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Generate a copilot-compatible MCP config snippet that can be added
 * to the user's VS Code settings.json or .github/copilot-instructions.md
 */
export function generateCopilotMcpSnippet(port?: number): string {
  const p = port || MCP_DEFAULT_PORT;
  return JSON.stringify(
    {
      servers: {
        [MCP_SERVER_NAME]: {
          type: 'sse',
          url: `http://127.0.0.1:${p}/sse`,
        },
      },
    },
    null,
    2,
  );
}
