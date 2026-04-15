import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import { HOOK_API_PREFIX, SERVER_JSON_DIR, SERVER_JSON_NAME } from '../../../constants.js';
import type { ServerConfig } from '../../../server.js';

const SERVER_JSON = path.join(os.homedir(), SERVER_JSON_DIR, SERVER_JSON_NAME);

/**
 * Normalize Codex native event names to the canonical PascalCase names that
 * hookEventHandler.ts expects.  Events that already carry a PascalCase
 * hook_event_name (e.g. a future Codex version that adopts the same schema)
 * are forwarded unchanged.
 *
 * Native Codex name  →  Canonical name
 * ─────────────────────────────────────
 * session_start      →  SessionStart
 * session_end        →  SessionEnd
 * stop               →  Stop
 * permission_request →  PermissionRequest
 * before_tool        →  PreToolUse
 * after_tool         →  PostToolUse
 * after_tool_failure →  PostToolUseFailure
 */
const EVENT_NAME_MAP: Record<string, string> = {
  session_start: 'SessionStart',
  session_end: 'SessionEnd',
  stop: 'Stop',
  permission_request: 'PermissionRequest',
  before_tool: 'PreToolUse',
  after_tool: 'PostToolUse',
  after_tool_failure: 'PostToolUseFailure',
};

/**
 * Normalize a raw Codex hook payload to the HookEvent shape the Pixel Agents
 * server understands.  Returns null if the payload cannot be mapped (e.g. it
 * has no recognisable event name or session identifier).
 */
function normalizeEvent(raw: Record<string, unknown>): Record<string, unknown> | null {
  // Prefer hook_event_name if already present (forward-compat with future Codex versions)
  let eventName = raw.hook_event_name as string | undefined;
  if (!eventName) {
    // Codex native lowercase field
    const nativeName = (raw.event ?? raw.type) as string | undefined;
    if (nativeName) {
      eventName = EVENT_NAME_MAP[nativeName] ?? nativeName;
    }
  }
  if (!eventName) return null;

  // Normalise session identifier (Codex may use session_id or id)
  const sessionId = (raw.session_id ?? raw.id) as string | undefined;
  if (!sessionId) return null;

  // Normalise tool fields for PreToolUse / PostToolUse
  // Codex may use tool_name/tool_input or tool/args interchangeably
  const toolName = (raw.tool_name ?? raw.tool) as string | undefined;
  const toolInput = (raw.tool_input ?? raw.args ?? raw.input) as
    | Record<string, unknown>
    | undefined;

  const normalized: Record<string, unknown> = {
    ...raw,
    hook_event_name: eventName,
    session_id: sessionId,
  };

  if (toolName !== undefined) normalized.tool_name = toolName;
  if (toolInput !== undefined) normalized.tool_input = toolInput;

  return normalized;
}

async function main(): Promise<void> {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const data = normalizeEvent(raw);
  if (!data) process.exit(0);

  let server: ServerConfig;
  try {
    server = JSON.parse(fs.readFileSync(SERVER_JSON, 'utf-8'));
  } catch {
    process.exit(0);
  }

  const body = JSON.stringify(data);
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.port,
        path: `${HOOK_API_PREFIX}/codex`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${server.token}`,
        },
        timeout: 2000,
      },
      () => resolve(),
    );
    req.on('error', () => resolve());
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
    req.end(body);
  });
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
