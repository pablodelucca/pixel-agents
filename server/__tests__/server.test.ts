import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HOOK_API_PREFIX } from '../src/constants.js';

// Use isolated temp HOME to avoid touching real ~/.pixel-agents/
let tmpBase: string;
let serverJsonDir: string;
let serverJsonPath: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

// Must import AFTER mock setup
const { PixelAgentsServer } = await import('../src/server.js');

/** Minimal fetch-like response returned by fetchViaSock. */
interface SockResponse {
  status: number;
  headers: { get(key: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/**
 * Issue an HTTP request over a Unix domain socket (or Windows named pipe).
 * Mimics the Fetch API response interface so tests read naturally.
 */
function fetchViaSock(
  socketPath: string,
  urlPath: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<SockResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path: urlPath,
        method: init.method ?? 'GET',
        headers: init.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          resolve({
            status: res.statusCode ?? 0,
            headers: {
              get: (k: string) => {
                const v = res.headers[k.toLowerCase()];
                return Array.isArray(v) ? v[0] : (v ?? null);
              },
            },
            json: async () => JSON.parse(body) as unknown,
            text: async () => body,
          });
        });
      },
    );
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

async function postHook(
  socketPath: string,
  token: string,
  body: string,
  providerId = 'claude',
): Promise<SockResponse> {
  return fetchViaSock(socketPath, `${HOOK_API_PREFIX}/${providerId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body,
  });
}

describe('PixelAgentsServer', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-server-test-'));
    serverJsonDir = path.join(tmpBase, '.pixel-agents');
    serverJsonPath = path.join(serverJsonDir, 'server.json');
    fs.mkdirSync(serverJsonDir, { recursive: true });
    server = new PixelAgentsServer();
  });

  afterEach(() => {
    server?.stop();
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // 1. Server starts and returns config
  it('starts and returns config with socketPath, token, pid', async () => {
    const config = await server.start();
    expect(config.socketPath).toBeTruthy();
    expect(config.token).toBeTruthy();
    expect(config.pid).toBe(process.pid);
    expect(config.startedAt).toBeGreaterThan(0);
  });

  // 2. Health endpoint returns 200 + uptime
  it('health endpoint returns 200 with uptime', async () => {
    const config = await server.start();
    const res = await fetchViaSock(config.socketPath, '/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; uptime: number; pid: number };
    expect(body.status).toBe('ok');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.pid).toBe(process.pid);
  });

  // 3. Hook endpoint requires auth
  it('hook endpoint returns 401 without auth', async () => {
    const config = await server.start();
    const res = await fetchViaSock(config.socketPath, '/api/hooks/claude', {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  // 4. Hook endpoint accepts valid auth
  it('hook endpoint returns 200 with valid auth', async () => {
    const config = await server.start();
    const res = await postHook(
      config.socketPath,
      config.token,
      JSON.stringify({ session_id: 'test', hook_event_name: 'Stop' }),
    );
    expect(res.status).toBe(200);
  });

  // 5. Hook callback fires on valid event
  it('hook callback fires on valid event', async () => {
    const config = await server.start();
    const received: Array<{ providerId: string; event: Record<string, unknown> }> = [];
    server.onHookEvent((providerId: string, event: Record<string, unknown>) => {
      received.push({ providerId, event });
    });

    await postHook(
      config.socketPath,
      config.token,
      JSON.stringify({ session_id: 'abc', hook_event_name: 'Stop' }),
    );

    expect(received).toHaveLength(1);
    expect(received[0].providerId).toBe('claude');
    expect(received[0].event.session_id).toBe('abc');
    expect(received[0].event.hook_event_name).toBe('Stop');
  });

  // 6. Hook endpoint rejects oversized body
  it('hook endpoint returns 413 for oversized body', async () => {
    const config = await server.start();
    const bigBody = 'x'.repeat(70_000); // > 64KB
    const res = await postHook(config.socketPath, config.token, bigBody);
    expect(res.status).toBe(413);
  });

  // 7. Hook endpoint rejects invalid JSON
  it('hook endpoint returns 400 for invalid JSON', async () => {
    const config = await server.start();
    const res = await postHook(config.socketPath, config.token, 'not json {{{');
    expect(res.status).toBe(400);
  });

  // 8. Hook endpoint rejects missing provider ID
  it('hook endpoint returns 400 for missing provider ID', async () => {
    const config = await server.start();
    const res = await fetchViaSock(config.socketPath, '/api/hooks/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}` },
      body: '{}',
    });
    expect(res.status).toBe(400);
  });

  // 9. server.json written
  it('writes server.json with socketPath, pid, token', async () => {
    const config = await server.start();
    const json = JSON.parse(fs.readFileSync(serverJsonPath, 'utf-8'));
    expect(json.socketPath).toBe(config.socketPath);
    expect(json.pid).toBe(process.pid);
    expect(json.token).toBe(config.token);
  });

  // 10. Second instance reuses existing server
  it('second instance reuses existing server', async () => {
    const config1 = await server.start();
    const server2 = new PixelAgentsServer();
    const config2 = await server2.start();
    expect(config2.socketPath).toBe(config1.socketPath);
    expect(config2.pid).toBe(config1.pid);
    server2.stop(); // should not delete server.json (not owner)
  });

  // 11. server.json cleaned up on stop
  it('deletes server.json on stop', async () => {
    await server.start();
    expect(fs.existsSync(serverJsonPath)).toBe(true);
    server.stop();
    expect(fs.existsSync(serverJsonPath)).toBe(false);
  });

  // 12. server.json NOT deleted if PID mismatch
  it('does not delete server.json if PID mismatch', async () => {
    // Write fake server.json with different PID
    fs.writeFileSync(
      serverJsonPath,
      JSON.stringify({ socketPath: '/tmp/fake.sock', pid: 999999, token: 'fake', startedAt: 0 }),
    );
    // Server never started (it would reuse), just stop
    const server2 = new PixelAgentsServer();
    server2.stop();
    expect(fs.existsSync(serverJsonPath)).toBe(true);
  });

  // 13. Unknown route returns 404
  it('unknown route returns 404', async () => {
    const config = await server.start();
    const res = await fetchViaSock(config.socketPath, '/random/path');
    expect(res.status).toBe(404);
  });

  // SEC-003: Security response headers
  describe('SEC-003: Security response headers', () => {
    it('sets security headers on health endpoint', async () => {
      const config = await server.start();
      const res = await fetchViaSock(config.socketPath, '/api/health');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    });

    it('sets security headers on hook endpoint', async () => {
      const config = await server.start();
      const res = await postHook(
        config.socketPath,
        config.token,
        JSON.stringify({ session_id: 'test', hook_event_name: 'Stop' }),
      );
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    });

    it('sets security headers on 401 unauthorized', async () => {
      const config = await server.start();
      const res = await postHook(config.socketPath, 'wrong-token', JSON.stringify({ session_id: 'x', hook_event_name: 'Stop' }));
      expect(res.status).toBe(401);
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    });
  });

  // 14. Hook callback does NOT fire for events missing required fields
  it('hook callback does not fire for events without session_id', async () => {
    const config = await server.start();
    const received: unknown[] = [];
    server.onHookEvent((_pid: string, event: Record<string, unknown>) => received.push(event));

    await postHook(
      config.socketPath,
      config.token,
      JSON.stringify({ hook_event_name: 'Stop' }), // missing session_id
    );

    expect(received).toHaveLength(0);
  });

  // SEC-007: Rate limiting tests
  describe('SEC-007: Rate Limiting', () => {
    it('returns rate limit headers on successful hook requests', async () => {
      const config = await server.start();
      const res = await postHook(
        config.socketPath,
        config.token,
        JSON.stringify({ session_id: 'test', hook_event_name: 'Stop' }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
      expect(res.headers.get('X-RateLimit-Remaining')).toBeTruthy();
    });

    it('returns 429 when rate limit exceeded', async () => {
      const config = await server.start();

      // Send 100 requests (at the limit)
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          postHook(
            config.socketPath,
            config.token,
            JSON.stringify({ session_id: `test-${i}`, hook_event_name: 'Stop' }),
          ),
        );
      }
      await Promise.all(promises);

      // 101st request should be rate limited
      const res = await postHook(
        config.socketPath,
        config.token,
        JSON.stringify({ session_id: 'final', hook_event_name: 'Stop' }),
      );
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBe('1');
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    });

    it('rate limits are per-provider', async () => {
      const config = await server.start();

      // Use up rate limit for 'claude'
      const claudePromises = [];
      for (let i = 0; i < 100; i++) {
        claudePromises.push(
          postHook(
            config.socketPath,
            config.token,
            JSON.stringify({ session_id: `test-${i}`, hook_event_name: 'Stop' }),
            'claude',
          ),
        );
      }
      await Promise.all(claudePromises);

      // 'other-provider' should still work
      const res = await postHook(
        config.socketPath,
        config.token,
        JSON.stringify({ session_id: 'test', hook_event_name: 'Stop' }),
        'other-provider',
      );
      expect(res.status).toBe(200);
    });
  });
});
