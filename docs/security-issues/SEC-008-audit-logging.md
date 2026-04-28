# SEC-008: No Formal Audit Logging for Security-Relevant Events

## Finding Details

| Field               | Value                           |
| ------------------- | ------------------------------- |
| **Finding ID**      | SEC-008                         |
| **Severity**        | Low                             |
| **Category**        | Audit Logging                   |
| **Status**          | ✅ Resolved                     |
| **Priority**        | P3 - Long-term (within 90 days) |
| **Resolution Date** | 2026-04-25                      |
| **SOC 2 Controls**  | CC7.2, CC7.3                    |

## Description

While the extension had a well-implemented logging module with sanitization and log levels, it
lacked formal audit logging for security-relevant events. SOC 2 CC7.2 requires monitoring of
security events, and CC7.3 requires evaluation of detected issues.

Security-relevant events were logged at various log levels mixed with operational messages with
no distinct audit log category, structured format, or machine-filterable prefix.

## Affected Files

- `src/agentManager.ts` — ad-hoc `[AUDIT]` string for bypass permissions (partial)
- `server/src/server.ts` — no logging for auth failures, rate limiting, or token generation
- `src/PixelAgentsViewProvider.ts` — no logging for layout imports or asset directory changes

## Security Events Audited

| Event                                                | Before                      | After                                  |
| ---------------------------------------------------- | --------------------------- | -------------------------------------- |
| Agent launched with `--dangerously-skip-permissions` | Ad-hoc string               | ✅ Structured JSON                     |
| Server auth token generated                          | Not logged                  | ✅ Structured JSON                     |
| Authentication failure (401 response)                | Implicit (HTTP status only) | ✅ Structured JSON                     |
| Rate limit triggered (429 response)                  | Not logged                  | ✅ Structured JSON                     |
| External asset directory added                       | Not logged                  | ✅ Structured JSON                     |
| External asset directory removed                     | Not logged                  | ✅ Structured JSON                     |
| Layout imported from external file                   | Not logged                  | ✅ Structured JSON (3 distinct events) |
| Hook script installed/uninstalled                    | INFO level (adequate)       | ✅ Already adequate                    |
| Extension activated/deactivated                      | INFO level (adequate)       | ✅ Already adequate                    |

## Remediation Implemented

### 1. Created `src/auditLogger.ts`

A dedicated audit logger module with a structured `AuditEvent` interface:

```typescript
interface AuditEvent {
  timestamp: string; // ISO-8601
  event: string; // snake_case event identifier
  actor: 'user' | 'system';
  resource: string; // subsystem / resource affected
  outcome: 'success' | 'failure';
  details?: Record<string, unknown>; // optional context (no secrets)
}

export function auditLog(event: AuditEvent): void {
  logger.warn(`[AUDIT] ${JSON.stringify(event)}`);
}
```

All events are emitted at `WARN` level with an `[AUDIT]` prefix so they:

- Are always captured in production (where INFO is suppressed)
- Can be filtered/forwarded by SIEM/log-aggregation tooling with `grep '\[AUDIT\]'`
- Pass through the existing sanitization pipeline (paths redacted, UUIDs partially redacted)

### 2. Created `server/src/auditLogger.ts`

Standalone version for the HTTP server (no VS Code dependencies), using the server's own
logger module.

### 3. Updated `src/agentManager.ts`

Replaced ad-hoc inline string with structured `auditLog()` call:

```typescript
auditLog({
  timestamp: new Date().toISOString(),
  event: 'agent_bypass_permissions',
  actor: 'user',
  resource: 'claude_terminal',
  outcome: 'success',
  details: { sessionId: sessionId.slice(0, 8) },
});
```

### 4. Updated `server/src/server.ts`

Added audit events for:

- `server_token_generated` — when a new auth token is generated at server startup
- `auth_failure` — when a request fails the Bearer token check (401)
- `rate_limit_triggered` — when a provider ID exceeds the rate limit (429), including the limit value

### 5. Updated `src/PixelAgentsViewProvider.ts`

Added audit events for:

- `external_asset_directory_added` — user adds an asset pack directory
- `external_asset_directory_removed` — user removes an asset pack directory
- `layout_import_succeeded` — user successfully imports a layout file
- `layout_import_schema_failed` — imported layout fails schema validation
- `layout_import_read_failed` — layout file cannot be read or parsed

## Acceptance Criteria

- [x] All security-relevant events emit structured JSON audit entries
- [x] All entries are tagged `[AUDIT]` and emitted at WARN level
- [x] No secrets or full paths included in audit details (sanitization pipeline applies)
- [x] Session IDs are partially redacted (only first 8 chars retained)
- [x] Dedicated `auditLog()` helper exists in both extension (`src/`) and server (`server/src/`)
- [x] TypeScript types enforce required fields (`timestamp`, `event`, `actor`, `resource`, `outcome`)

## Log Retention & SIEM Integration

For enterprise deployments, the `[AUDIT]` prefix enables straightforward integration:

```bash
# Filter audit events from VS Code output channel logs
grep '\[AUDIT\]' ~/.vscode/extensions/pixel-agents.log | jq .

# Forward to syslog
journalctl -f | grep '\[AUDIT\]' | logger -t pixel-agents-audit
```

The JSON format is compatible with common log-aggregation systems (Splunk, Datadog, ELK).

## SOC 2 Mapping

| Control | Relevance                                                                        |
| ------- | -------------------------------------------------------------------------------- |
| CC7.2   | Security events are now monitored and logged with structured, filterable records |
| CC7.3   | Detected security issues (auth failures, rate limits) are logged for evaluation  |

---

**Labels**: `security`, `soc2`, `audit`, `compliance`
