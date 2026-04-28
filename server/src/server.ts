import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import { auditLog } from './auditLogger.js';
import {
  HOOK_API_PREFIX,
  MAX_CONCURRENT_CONNECTIONS,
  MAX_HOOK_BODY_SIZE,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  SERVER_JSON_DIR,
  SERVER_JSON_NAME,
} from './constants.js';
import { logger } from './logger.js';
import { RateLimiter } from './rateLimiter.js';

/** Discovery file written to ~/.pixel-agents/server.json so hook scripts can find the server. */
export interface ServerConfig {
  /** Unix domain socket path (or Windows named pipe path) the server is listening on */
  socketPath: string;
  /** PID of the process that owns the server */
  pid: number;
  /** Auth token required in Authorization header for hook requests (defense-in-depth) */
  token: string;
  /** Timestamp (ms) when the server started */
  startedAt: number;
}

/** Callback invoked when a hook event is received from a provider's hook script. */
type HookEventCallback = (providerId: string, event: Record<string, unknown>) => void;

/**
 * HTTP server that receives hook events from CLI tool hook scripts.
 *
 * Routes:
 * - `POST /api/hooks/:providerId` -- hook event (auth required, 64KB body limit)
 * - `GET /api/health` -- health check (no auth)
 *
 * Discovery: writes `~/.pixel-agents/server.json` with port, PID, and auth token.
 * Multi-window: second VS Code window detects running server via server.json and
 * reuses it (does not start a second server).
 *
 * This will becomes the standalone server with added WebSocket and SPA serving.
 */
export class PixelAgentsServer {
  private server: http.Server | null = null;
  private config: ServerConfig | null = null;
  private ownsServer = false;
  private callback: HookEventCallback | null = null;
  private startTime = Date.now();
  private rateLimiter = new RateLimiter(RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS);
  private activeConnections = 0;

  /** Register a callback for incoming hook events from any provider. */
  onHookEvent(callback: HookEventCallback): void {
    this.callback = callback;
  }

  /**
   * Start the HTTP server. If another instance is already running (detected via
   * server.json PID check), reuses that server's config without starting a new one.
   * @returns The server config (port, token) for hook script discovery.
   */
  async start(): Promise<ServerConfig> {
    // Check if another instance already has a server running
    const existing = this.readServerJson();
    if (existing && isProcessRunning(existing.pid)) {
      // Another VS Code window owns the server, reuse its config
      this.config = existing;
      this.ownsServer = false;
      logger.info(`Reusing existing server on socket ${existing.socketPath} (PID ${existing.pid})`);
      return existing;
    }

    // Start our own server
    const token = crypto.randomUUID();
    this.startTime = Date.now();
    const socketPath = getSocketPath();

    // Remove any stale socket file from a previous (crashed) process
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(socketPath);
      } catch {
        /* ignore — file may not exist */
      }
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', reject);
      this.server.setTimeout(5000);

      this.server.listen(socketPath, () => {
        // Restrict socket to owner-only access (filesystem ACL authentication)
        if (process.platform !== 'win32') {
          try {
            fs.chmodSync(socketPath, 0o600);
          } catch {
            /* non-fatal — permissions best-effort */
          }
        }
        this.config = {
          socketPath,
          pid: process.pid,
          token,
          startedAt: this.startTime,
        };
        this.ownsServer = true;
        this.writeServerJson(this.config);
        // Audit log: new auth token generated (SEC-008)
        auditLog({
          timestamp: new Date().toISOString(),
          event: 'server_token_generated',
          actor: 'system',
          resource: 'hook_server',
          outcome: 'success',
        });
        // Replace startup error handler with runtime error handler
        this.server!.removeListener('error', reject);
        this.server!.on('error', (err) => {
          logger.error(`Server: error: ${err}`);
        });
        logger.info(`Server: listening on socket ${socketPath}`);
        resolve(this.config);
      });
    });
  }

  /** Stop the HTTP server and clean up server.json (only if we own it). */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    // Clean up rate limiter resources (SEC-007)
    this.rateLimiter.dispose();
    // Only delete server.json and socket if we own it (our PID)
    if (this.ownsServer) {
      const socketPath = this.config?.socketPath;
      this.deleteServerJson();
      if (socketPath && process.platform !== 'win32') {
        try {
          fs.unlinkSync(socketPath);
        } catch {
          /* ignore — may already be gone */
        }
      }
    }
    this.config = null;
    this.ownsServer = false;
  }

  /** Returns the current server config, or null if not started. */
  getConfig(): ServerConfig | null {
    return this.config;
  }

  /**
   * Set standard security headers on all HTTP responses (SEC-003).
   * Even though the server is localhost-only, defense-in-depth requires these headers to
   * prevent MIME sniffing, caching of authenticated responses, and browser-based attacks
   * from same-machine pages that may reach the local port.
   */
  private setSecurityHeaders(res: http.ServerResponse): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
  }

  /** Top-level request router. Dispatches to health or hook handler based on method + path. */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Set security headers on every response (SEC-003: defense-in-depth for localhost server)
    this.setSecurityHeaders(res);

    // Connection limit check (SEC-007: prevents DoS via connection exhaustion)
    if (this.activeConnections >= MAX_CONCURRENT_CONNECTIONS) {
      res.writeHead(503, { 'Retry-After': '1' });
      res.end('server busy');
      return;
    }

    // Track connection lifecycle
    this.activeConnections++;
    res.on('close', () => {
      this.activeConnections--;
    });

    const url = req.url ?? '';

    // Health endpoint (no auth required)
    if (req.method === 'GET' && url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          pid: process.pid,
        }),
      );
      return;
    }

    // Hook event endpoint: POST /api/hooks/:providerId
    if (req.method === 'POST' && url.startsWith(HOOK_API_PREFIX + '/')) {
      this.handleHookRequest(req, res, url);
      return;
    }

    res.writeHead(404);
    res.end();
  }

  /** Handle POST /api/hooks/:providerId. Validates auth, enforces body size limit, parses JSON. */
  private handleHookRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: string,
  ): void {
    // Validate auth token (timing-safe comparison prevents side-channel attacks)
    const authHeader = req.headers['authorization'] ?? '';
    const expectedToken = `Bearer ${this.config?.token ?? ''}`;
    const authBuf = Buffer.from(authHeader);
    const expectedBuf = Buffer.from(expectedToken);
    if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
      // Audit log: authentication failure (SEC-008)
      auditLog({
        timestamp: new Date().toISOString(),
        event: 'auth_failure',
        actor: 'system',
        resource: 'hook_endpoint',
        outcome: 'failure',
      });
      res.writeHead(401);
      res.end('unauthorized');
      return;
    }

    // Extract and validate provider ID from URL: /api/hooks/claude -> "claude"
    const providerId = url.slice(HOOK_API_PREFIX.length + 1);
    if (!providerId || !/^[a-z0-9-]+$/.test(providerId)) {
      res.writeHead(400);
      res.end('invalid provider id');
      return;
    }

    // Rate limit by provider ID (SEC-007: prevents DoS from flooding local processes)
    if (!this.rateLimiter.isAllowed(providerId)) {
      const limit = this.rateLimiter.getLimit();
      // Audit log: rate limit triggered (SEC-008)
      auditLog({
        timestamp: new Date().toISOString(),
        event: 'rate_limit_triggered',
        actor: 'system',
        resource: `hook_endpoint:${providerId}`,
        outcome: 'failure',
        details: { limit },
      });
      res.writeHead(429, {
        'Retry-After': '1',
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Remaining': '0',
      });
      res.end('rate limited');
      return;
    }

    // Add rate limit headers to successful responses
    const remaining = this.rateLimiter.getRemaining(providerId);
    const limit = this.rateLimiter.getLimit();

    // Read body with size limit and response guard
    let body = '';
    let bodySize = 0;
    let responded = false;

    req.on('data', (chunk: Buffer) => {
      bodySize += chunk.length;
      if (bodySize > MAX_HOOK_BODY_SIZE && !responded) {
        responded = true;
        res.writeHead(413);
        res.end('payload too large');
        req.destroy();
        return;
      }
      if (!responded) {
        body += chunk.toString();
      }
    });

    req.on('end', () => {
      if (responded) return;
      try {
        const event = JSON.parse(body) as Record<string, unknown>;
        if (event.session_id && event.hook_event_name) {
          this.callback?.(providerId, event);
        }
        res.writeHead(200, {
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': remaining.toString(),
        });
        res.end('ok');
      } catch {
        res.writeHead(400);
        res.end('invalid json');
      }
    });
  }

  /** Returns the absolute path to ~/.pixel-agents/server.json. */
  private getServerJsonPath(): string {
    return path.join(os.homedir(), SERVER_JSON_DIR, SERVER_JSON_NAME);
  }

  /** Read and parse server.json. Returns null if missing or malformed. */
  private readServerJson(): ServerConfig | null {
    try {
      const filePath = this.getServerJsonPath();
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ServerConfig;
    } catch {
      return null;
    }
  }

  /** Write server.json atomically (tmp + rename) with mode 0o600. */
  private writeServerJson(config: ServerConfig): void {
    const filePath = this.getServerJsonPath();
    const dir = path.dirname(filePath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      // Atomic write with restricted permissions
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
      fs.renameSync(tmpPath, filePath);
    } catch (e) {
      logger.error(`Failed to write server.json: ${e}`);
    }
  }

  /** Delete server.json only if the PID inside matches our process (safe for multi-window). */
  private deleteServerJson(): void {
    try {
      const filePath = this.getServerJsonPath();
      if (!fs.existsSync(filePath)) return;
      // Only delete if our PID matches (don't delete another instance's server file)
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ServerConfig;
      if (existing.pid === process.pid) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // File may already be gone
    }
  }
}

/** Check if a process is alive by sending signal 0 (no-op, just checks existence). */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Return a fresh Unix domain socket path (or Windows named pipe path) for a new server instance.
 * Uses the PID plus a short random suffix so that:
 *  - Concurrent test instances don't collide (each start() gets a unique socket).
 *  - Real deployments are still associated with the owning process.
 *  - The path is stable for the lifetime of one server but not reused across restarts.
 * Using a Unix socket eliminates all network-layer interception of the auth token
 * and provides filesystem-ACL-based access control (SEC-006).
 */
function getSocketPath(): string {
  const suffix = crypto.randomBytes(4).toString('hex');
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\pixel-agents-${process.pid}-${suffix}`;
  }
  return path.join(os.tmpdir(), `pixel-agents-${process.pid}-${suffix}.sock`);
}
