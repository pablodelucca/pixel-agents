import { Client } from 'ssh2';

import type { SSHOptions } from '../types/index.js';
import { OpenClawConfigSchema } from '../types/index.js';

const OPENCLAW_CONFIG_PATH = '/root/.openclaw/openclaw.json';
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
    const agents = config.agents?.list ?? [];

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
