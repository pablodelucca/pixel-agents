import { spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK_SCRIPT = path.join(__dirname, '../../dist/hooks/claude-hook.js');

// Isolated temp HOME
let tmpBase: string;
// Sockets created during tests (cleaned up in afterEach)
let cleanupSockets: string[] = [];

function writeServerJson(socketPath: string, token: string): void {
  const dir = path.join(tmpBase, '.pixel-agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'server.json'),
    JSON.stringify({ socketPath, pid: process.pid, token, startedAt: Date.now() }),
  );
}

/** Run the hook script with given stdin, returns exit code. */
function runHookScript(stdin: string): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [HOOK_SCRIPT], {
      env: { ...process.env, HOME: tmpBase },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.on('close', (code) => resolve({ code, stdout }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

/** Create a Unix domain socket path unique to this test run. */
function makeTestSocketPath(suffix: string): string {
  const sockPath = path.join(os.tmpdir(), `pxl-hook-int-${process.pid}-${suffix}.sock`);
  cleanupSockets.push(sockPath);
  // Remove any stale socket from a previous run
  try {
    fs.unlinkSync(sockPath);
  } catch {
    /* ignore */
  }
  return sockPath;
}

describe('claude-hook.js integration', () => {
  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-hook-int-'));
    cleanupSockets = [];
  });

  afterEach(() => {
    for (const sp of cleanupSockets) {
      try {
        fs.unlinkSync(sp);
      } catch {
        /* ignore */
      }
    }
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // Skip if hook script not built
  function skipIfNotBuilt(): void {
    if (!fs.existsSync(HOOK_SCRIPT)) {
      console.warn(`Skipping: ${HOOK_SCRIPT} not found. Run 'npm run compile' first.`);
    }
  }

  // 1. Script reads stdin and POSTs to server
  it('reads stdin and POSTs to server', async () => {
    skipIfNotBuilt();
    if (!fs.existsSync(HOOK_SCRIPT)) return;

    const received: string[] = [];
    const sockPath = makeTestSocketPath('recv');
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        received.push(body);
        res.writeHead(200);
        res.end('ok');
      });
    });

    await new Promise<void>((r) => server.listen(sockPath, r));
    writeServerJson(sockPath, 'test-token');

    const event = JSON.stringify({ session_id: 'abc', hook_event_name: 'Stop' });
    const { code } = await runHookScript(event);

    server.close();
    expect(code).toBe(0);
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0]).session_id).toBe('abc');
  });

  // 2. Script exits 0 on missing server.json
  it('exits 0 when server.json is missing', async () => {
    skipIfNotBuilt();
    if (!fs.existsSync(HOOK_SCRIPT)) return;

    // Don't write server.json
    const { code } = await runHookScript(
      JSON.stringify({ session_id: 'x', hook_event_name: 'Stop' }),
    );
    expect(code).toBe(0);
  });

  // 5. Script exits 0 on invalid stdin
  it('exits 0 on invalid stdin', async () => {
    skipIfNotBuilt();
    if (!fs.existsSync(HOOK_SCRIPT)) return;

    writeServerJson('/tmp/nonexistent.sock', 'tok');
    const { code } = await runHookScript('not json at all!!!');
    expect(code).toBe(0);
  });

  // 6. Script handles server timeout
  it('exits within 5s when server does not respond', async () => {
    skipIfNotBuilt();
    if (!fs.existsSync(HOOK_SCRIPT)) return;

    // Start a server that never responds
    const sockPath = makeTestSocketPath('timeout');
    const server = http.createServer(() => {
      // intentionally never respond
    });
    await new Promise<void>((r) => server.listen(sockPath, r));
    writeServerJson(sockPath, 'tok');

    const start = Date.now();
    const { code } = await runHookScript(
      JSON.stringify({ session_id: 'x', hook_event_name: 'Stop' }),
    );
    const elapsed = Date.now() - start;

    server.close();
    expect(code).toBe(0);
    expect(elapsed).toBeLessThan(5000);
  });
});
