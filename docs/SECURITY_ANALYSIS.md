# Security Analysis Report

## Executive Summary

This document provides a comprehensive security analysis of the Pixel Agents VS Code extension, identifying vulnerabilities, exposure risks, and other potential information security concerns for enterprise software deployment.

**Overall Risk Assessment: MEDIUM**

The Pixel Agents extension is a VS Code extension that provides a pixel art visualization for Claude Code AI agents. It operates in a sandboxed webview environment within VS Code and communicates with Claude Code CLI through file system watching and HTTP hooks.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Security Findings](#security-findings)
3. [Risk Assessment Matrix](#risk-assessment-matrix)
4. [Detailed Findings](#detailed-findings)
5. [Recommendations](#recommendations)
6. [Security Controls in Place](#security-controls-in-place)

---

## Architecture Overview

### Components

| Component         | Technology            | Security Boundary          |
| ----------------- | --------------------- | -------------------------- |
| Extension Backend | Node.js, VS Code API  | VS Code Extension Host     |
| HTTP Server       | Node.js `http` module | localhost only (127.0.0.1) |
| Webview Frontend  | React, TypeScript     | VS Code Webview Sandbox    |
| File Watchers     | Node.js `fs` module   | Local filesystem           |
| Hook Script       | Node.js               | Claude Code process        |

### Data Flow

```
Claude Code CLI → JSONL Files → File Watchers → Extension Backend → Webview
                     ↓
              Hook Events → HTTP Server → Extension Backend → Webview
```

### Trust Boundaries

1. **User → Extension**: VS Code API sandbox
2. **Extension → Filesystem**: Local user home directory
3. **Extension → HTTP Server**: localhost with auth token
4. **Extension → Webview**: VS Code postMessage API

---

## Security Findings

### Critical Findings: 0

### High Severity Findings: 0

### Medium Severity Findings: 4

### Low Severity Findings: 7

### Informational Findings: 5

---

## Risk Assessment Matrix

| Finding ID | Severity | Category                    | CVSS (Est.) | Status    |
| ---------- | -------- | --------------------------- | ----------- | --------- |
| SEC-001    | Medium   | Input Validation            | 5.5         | Resolved  |
| SEC-002    | Medium   | Path Traversal              | 5.0         | Verified  |
| SEC-003    | Medium   | Information Disclosure      | 4.5         | Resolved  |
| SEC-004    | Medium   | Insufficient CSP            | 4.0         | Resolved  |
| SEC-005    | Low      | Token Exposure              | 3.5         | Verified  |
| SEC-006    | Low      | Insecure File Permissions   | 3.0         | Verified  |
| SEC-007    | Low      | Missing Rate Limiting       | 3.0         | Resolved  |
| SEC-008    | Low      | Error Information Leakage   | 2.5         | Verified  |
| SEC-009    | Low      | Unvalidated Redirects       | 2.0         | Verified  |
| SEC-010    | Low      | Dependency Versions         | 2.0         | Verified  |
| SEC-011    | Low      | Missing Input Length Limits | 2.0         | Resolved  |
| SEC-012    | Info     | Console Logging             | 1.0         | Resolved  |
| SEC-013    | Info     | Debug Mode                  | 1.0         | Resolved  |
| SEC-014    | Info     | External Asset Loading      | 1.0         | Accepted  |
| SEC-015    | Info     | Missing Security Headers    | 1.0         | N/A       |
| SEC-016    | Info     | CORS Not Configured         | 1.0         | N/A       |

---

## Detailed Findings

### SEC-001: JSON Parsing Without Schema Validation (Medium - Resolved)

**Location**: Multiple files

- `src/transcriptParser.ts:102`
- `src/layoutPersistence.ts:28`
- `src/configPersistence.ts:24`
- `src/PixelAgentsViewProvider.ts:779`

**Description**: JSON data is parsed with Zod schema validation. All external JSON sources (JSONL transcript files, layout files, config files, imported layouts) are validated against defined schemas before processing.

**Resolution**:

- Added Zod dependency for runtime schema validation
- Created schemas in `src/schemas/`:
  - `transcript.ts` - TranscriptRecordSchema for JSONL records
  - `layout.ts` - LayoutSchema for office layout files
  - `config.ts` - ConfigSchema for configuration files
- Updated all JSON.parse calls to use schema validation:
  - `transcriptParser.ts` - Uses `validateTranscriptRecord()`
  - `layoutPersistence.ts` - Uses `parseLayout()`
  - `configPersistence.ts` - Uses `parseConfig()`
  - `PixelAgentsViewProvider.ts` - Uses `parseLayout()` for imports
- Invalid data is handled gracefully (logged and skipped, no crashes)
- Added comprehensive unit tests in `server/__tests__/schemas.test.ts`

**Code Example** (After):

```typescript
// src/transcriptParser.ts
const parsed = JSON.parse(line);
const record = validateTranscriptRecord(parsed);
if (!record) {
  // Schema validation failed - log and skip
  return;
}
```

**Current Status**: RESOLVED

---

### SEC-002: Path Traversal Protection (Medium - Mitigated)

**Location**: `src/assetLoader.ts:139-147`

**Description**: External asset directories are user-configurable. The code includes path traversal protection but should be reviewed.

**Code Example** (Mitigation in place):

```typescript
const resolvedAsset = path.resolve(assetPath);
const resolvedDir = path.resolve(itemDir);
if (!resolvedAsset.startsWith(resolvedDir + path.sep) && resolvedAsset !== resolvedDir) {
  console.warn(`Skipping asset with path outside directory: ${asset.file}`);
  continue;
}
```

**Risk**: Without this check, a malicious manifest could load files from arbitrary locations.

**Current Status**: MITIGATED - Path traversal protection is implemented.

**Recommendation**:

- Consider using `path.relative()` and checking for `..` segments
- Add additional validation for symlinks on Unix systems

---

### SEC-003: Sensitive Data Exposure in Logs (Medium - Resolved)

**Location**: `src/logger.ts`, `server/src/logger.ts`

**Description**: The extension logs detailed diagnostic information including file paths, session IDs, and project directories to the console.

**Risk**: In shared or logged environments, these messages could expose:

- User home directory paths
- Project structures
- Session identifiers
- File system layout

**Resolution**:

- Created structured logging module (`src/logger.ts` and `server/src/logger.ts`)
- Implemented log levels: DEBUG, INFO, WARN, ERROR, NONE
- Implemented path sanitization (home directory → `~`)
- Implemented session ID sanitization (partial redaction: `12345678-****-****-****-************`)
- Configurable via environment variable `PIXEL_AGENTS_LOG_LEVEL`
- Production mode defaults to WARN level with sanitization enabled
- Legacy `PIXEL_AGENTS_DEBUG` environment variable supported for backwards compatibility
- All console.log calls throughout the codebase have been replaced with logger calls:
  - Extension backend: `src/extension.ts`, `src/agentManager.ts`, `src/fileWatcher.ts`, etc.
  - Server: `server/src/server.ts`, `server/src/hookEventHandler.ts`, etc.

**Code Example** (After):

```typescript
// src/logger.ts
export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4,
} as const;

class Logger {
  sanitize(message: string): string {
    // Replace home directory with ~
    // Replace UUIDs with partial redaction
    return sanitized;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.config.level <= LogLevel.DEBUG) {
      console.log(this.config.prefix, this.sanitize(message), ...);
    }
  }
}
```

**Current Status**: RESOLVED

---

### SEC-004: Missing Content Security Policy (Medium - Resolved)

**Location**: `src/PixelAgentsViewProvider.ts` (webview configuration)

**Description**: The webview now configures an explicit Content Security Policy (CSP) that provides defense-in-depth against XSS attacks.

**Resolution**:

- Added `getNonce()` function to generate cryptographically secure nonces for inline scripts
- Added CSP meta tag injection in `getWebviewContent()` with the following directives:
  - `default-src 'none'` (deny by default)
  - `img-src ${cspSource} data: blob:` (allow webview source, data URIs for canvas, blob for dynamic images)
  - `script-src ${cspSource} 'nonce-${nonce}'` (allow webview source + nonce for inline scripts)
  - `style-src ${cspSource} 'unsafe-inline'` (allow webview source + inline styles for Tailwind CSS)
  - `font-src ${cspSource}` (allow webview source for custom fonts)
  - `connect-src ${cspSource}` (allow webview source for fetch/XHR)
- Added `localResourceRoots` restriction to limit resource loading to the `dist` directory
- Script tags are automatically tagged with nonces for CSP compliance

**Code Example** (After):

```typescript
// src/PixelAgentsViewProvider.ts
webviewView.webview.options = {
  enableScripts: true,
  localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
};

// CSP is injected into HTML with:
const cspContent = [
  `default-src 'none'`,
  `img-src ${cspSource} data: blob:`,
  `script-src ${cspSource} 'nonce-${nonce}'`,
  `style-src ${cspSource} 'unsafe-inline'`,
  `font-src ${cspSource}`,
  `connect-src ${cspSource}`,
].join('; ');
```

**Current Status**: RESOLVED

---

### SEC-005: Auth Token Storage (Low - Mitigated)

**Location**: `server/src/server.ts:231-242`

**Description**: The HTTP server authentication token is stored in `~/.pixel-agents/server.json`.

**Code Example** (Mitigation in place):

```typescript
// Atomic write with restricted permissions
const tmpPath = filePath + '.tmp';
fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
fs.renameSync(tmpPath, filePath);
```

**Current Status**: MITIGATED - File is created with mode 0o600 (user read/write only).

**Recommendation**:

- Verify directory is also created with restricted permissions (currently 0o700 - correct)
- Consider using OS keychain for token storage in enterprise environments

---

### SEC-006: Directory Creation Permissions (Low - Mitigated)

**Location**: `server/src/server.ts:237`

**Description**: Directories for configuration files are created with appropriate permissions.

**Code Example**:

```typescript
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
```

**Current Status**: MITIGATED - Directory created with 0o700 (user only).

---

### SEC-007: Missing Rate Limiting on HTTP Server (Low - Resolved)

**Location**: `server/src/server.ts`, `server/src/rateLimiter.ts`

**Description**: The HTTP server now implements rate limiting and connection limiting to prevent DoS attacks from local processes.

**Resolution**:

- Created `RateLimiter` class with sliding window algorithm
- Configured 100 requests/second per provider limit
- Added global connection limit of 50 concurrent connections
- Returns 429 with `Retry-After` and `X-RateLimit-*` headers
- Returns 503 when connection limit exceeded

**Code Example** (After):

```typescript
// server/src/server.ts
private rateLimiter = new RateLimiter(100, 1000);

if (!this.rateLimiter.isAllowed(providerId)) {
  res.writeHead(429, {
    'Retry-After': '1',
    'X-RateLimit-Limit': '100',
    'X-RateLimit-Remaining': '0',
  });
  res.end('rate limited');
  return;
}
```

**Current Status**: RESOLVED

---

### SEC-008: Error Information Leakage (Low - Verified)

**Location**: Multiple error handling locations

**Description**: Error messages are minimal and do not expose internal implementation details.

**Verification**: HTTP error responses reviewed:
- `401`: "unauthorized"
- `400`: "invalid provider id" / "invalid json"
- `413`: "payload too large"
- `429`: "rate limited"
- `503`: "server busy"

**Current Status**: VERIFIED - Error messages are generic and safe.

---

### SEC-009: File URI Handling (Low - Verified)

**Location**: `src/PixelAgentsViewProvider.ts`

**Description**: The extension opens file URIs using VS Code's openExternal API.

**Verification**: `vscode.env.openExternal()` is only called with paths derived from:
- Workspace folders (trusted VS Code API)
- JSONL file parent directories (derived from Claude Code configuration)

No user-controlled input flows into file URIs.

**Current Status**: VERIFIED - Paths are always derived from trusted sources.

---

### SEC-010: Dependency Management (Low - Verified)

**Location**: `package.json`, `webview-ui/package.json`, `server/package.json`

**Description**: Dependencies are managed with npm and automated updates via Dependabot.

**Verified Controls**:

- ✅ Dependabot enabled for weekly updates
- ✅ `npm audit` runs in CI at moderate level
- ✅ All dependencies are well-known, maintained packages
- ✅ TypeScript strict mode enabled
- ✅ ESLint with security-conscious rules

**Dependencies Summary**:

- React 19.2.0
- TypeScript 5.9.x
- esbuild 0.28.x
- Playwright 1.58.x (dev only)
- pngjs 7.0.0

**Current Status**: VERIFIED - Dependency security is actively monitored.

---

### SEC-011: Input Length Validation (Low - Resolved)

**Location**: `server/src/server.ts`, `src/fileWatcher.ts`, `server/src/constants.ts`

**Description**: Both the HTTP server and JSONL file reader implement input length limits.

**Resolution**:

- HTTP body size limit: 64KB (existing)
- JSONL line length limit: 1MB (added)
- Line buffer overflow protection: truncate and skip to end of file

**Code Example** (After):

```typescript
// src/fileWatcher.ts
import { MAX_JSONL_LINE_LENGTH } from '../server/src/constants.js';

// Line buffer size check
if (agent.lineBuffer.length > MAX_JSONL_LINE_LENGTH) {
  logger.warn(`Agent ${agentId} - line buffer exceeded max length, truncating`);
  agent.lineBuffer = '';
  agent.fileOffset = stat.size;
  return;
}

// Individual line length check
if (line.length > MAX_JSONL_LINE_LENGTH) {
  logger.warn(`Agent ${agentId} - skipping line exceeding max length`);
  continue;
}
```

**Current Status**: RESOLVED

---

### SEC-012: Debug Console Logging (Informational - Resolved)

**Location**: `src/logger.ts`, `server/src/logger.ts`

**Description**: Debug logging is now controlled through a centralized logger module with proper log levels.

**Resolution**:
- Created structured logging modules with log levels (DEBUG, INFO, WARN, ERROR, NONE)
- Default level is INFO (not DEBUG) - production-safe default
- Explicit opt-in for debug: `PIXEL_AGENTS_DEBUG=1` or `PIXEL_AGENTS_LOG_LEVEL=DEBUG`
- Legacy compatibility: `PIXEL_AGENTS_DEBUG=0` still works to suppress debug logs

**Current Status**: RESOLVED

---

### SEC-013: Debug Mode in Webview (Informational - Resolved)

**Location**: `webview-ui/src/App.tsx`

**Description**: Debug view can be toggled via settings modal by user action only.

**Resolution**: Debug mode requires explicit user action (toggle in settings modal). It is not enabled by default and poses minimal risk as the webview only shows internal visualization state, not sensitive data.

**Current Status**: RESOLVED - Acceptable risk with user-initiated toggle.

---

### SEC-014: External Asset Directory Loading (Informational - Accepted)

**Location**: `src/configPersistence.ts`, `src/assetLoader.ts`

**Description**: Users can configure external asset directories for custom furniture/sprites. Path traversal protection (SEC-002) mitigates the primary risk.

**Mitigations in Place**:
- Path traversal protection prevents loading files outside configured directories
- User must explicitly configure directories
- Only PNG and JSON files are processed

**Current Status**: ACCEPTED - Feature provides legitimate value with existing mitigations.

---

### SEC-015: Missing Security Headers (Informational - N/A)

**Description**: The HTTP server only serves hook API endpoints to localhost. Traditional security headers (X-Frame-Options, X-Content-Type-Options) are not applicable.

---

### SEC-016: CORS Configuration (Informational - N/A)

**Description**: No CORS configuration needed as server only accepts localhost connections.

---

## Recommendations

### Immediate Actions (Priority 1)

1. ~~**Add JSON Schema Validation**~~ ✅ COMPLETED
   - ~~Implement Zod or similar for runtime validation~~
   - ~~Validate imported layouts before processing~~
   - ~~Validate JSONL records before accessing properties~~

2. ~~**Configure Explicit CSP**~~ ✅ COMPLETED
   - ~~Add Content-Security-Policy to webview HTML~~
   - ~~Use VS Code's `webview.cspSource` helper~~

### Short-Term Actions (Priority 2)

3. ~~**Implement Structured Logging**~~ ✅ COMPLETED
   - ~~Add log levels with configuration~~
   - ~~Sanitize sensitive data in logs~~
   - ~~Disable debug logging in production~~

4. ~~**Add Rate Limiting**~~ ✅ COMPLETED
   - ~~Implement simple rate limiting on HTTP server~~
   - ~~Add connection pooling limits~~

### Long-Term Actions (Priority 3)

5. **Security Testing** (Ongoing)
   - Add security-focused test cases
   - Consider fuzzing JSON parsers
   - Add path traversal test cases

6. **Enterprise Features** (Future)
   - Add policy configuration options
   - Allow disabling external asset directories
   - Add audit logging option

---

## Security Controls in Place

### Positive Security Controls

| Control                               | Location                     | Effectiveness |
| ------------------------------------- | ---------------------------- | ------------- |
| JSON Schema Validation (Zod)          | src/schemas/\*.ts            | ✅ Good       |
| Auth Token for HTTP API               | server/src/server.ts         | ✅ Good       |
| Timing-Safe Token Comparison          | server/src/server.ts:166     | ✅ Good       |
| Localhost-Only HTTP Server            | server/src/server.ts:84      | ✅ Good       |
| File Permission Restrictions          | server/src/server.ts:237,241 | ✅ Good       |
| Path Traversal Prevention             | src/assetLoader.ts:139-147   | ✅ Good       |
| Body Size Limits                      | server/src/server.ts:182-193 | ✅ Good       |
| JSONL Line Length Limits              | src/fileWatcher.ts           | ✅ Good       |
| Rate Limiting                         | server/src/rateLimiter.ts    | ✅ Good       |
| Connection Limiting                   | server/src/server.ts         | ✅ Good       |
| Atomic File Writes                    | Multiple locations           | ✅ Good       |
| Provider ID Validation                | server/src/server.ts:174     | ✅ Good       |
| VS Code Webview Sandbox               | Inherent                     | ✅ Good       |
| Content Security Policy               | src/PixelAgentsViewProvider  | ✅ Good       |
| Structured Logging with Sanitization  | src/logger.ts                | ✅ Good       |
| No eval() or innerHTML with user data | Throughout codebase          | ✅ Good       |
| Dependabot Updates                    | .github/dependabot.yml       | ✅ Good       |
| npm audit in CI                       | .github/workflows/ci.yml     | ✅ Good       |
| Gitleaks Configuration                | .gitleaks.toml               | ✅ Good       |
| TypeScript Strict Mode                | tsconfig.json                | ✅ Good       |
| ESLint Security Rules                 | eslint.config.mjs            | ⚠️ Partial    |

### Security-Related CI Checks

- TypeScript type checking
- ESLint linting
- npm audit (moderate level)
- Dependabot automated updates

---

## Appendix A: Attack Surface Analysis

### External Attack Surface

| Entry Point          | Protocol         | Risk Level |
| -------------------- | ---------------- | ---------- |
| Webview postMessage  | VS Code IPC      | Low        |
| HTTP Hook Endpoint   | HTTP (localhost) | Low        |
| File System (JSONL)  | Local FS         | Low        |
| File System (Config) | Local FS         | Low        |
| File System (Assets) | Local FS         | Low        |

### Internal Attack Surface

| Component         | Risk Level | Notes                     |
| ----------------- | ---------- | ------------------------- |
| JSON Parsing      | Medium     | Multiple entry points     |
| File I/O          | Low        | Restricted to known paths |
| Terminal Creation | Low        | VS Code API sandboxed     |

---

## Appendix B: Compliance Considerations

### SOC 2

- **Access Control**: Auth tokens for HTTP API ✅
- **Data Protection**: Local storage with restricted permissions ✅
- **Logging**: Present but needs enhancement ⚠️
- **Change Management**: Git-based, CI/CD in place ✅

### GDPR

- **Data Minimization**: Only processes necessary data ✅
- **Data Storage**: Local to user machine only ✅
- **No PII Collection**: Extension does not collect PII ✅

---

## Appendix C: Threat Model

### STRIDE Analysis

| Threat                     | Applicable | Mitigation                  |
| -------------------------- | ---------- | --------------------------- |
| **S**poofing               | Low        | Auth token for HTTP         |
| **T**ampering              | Medium     | File integrity not verified |
| **R**epudiation            | Low        | Not applicable              |
| **I**nformation Disclosure | Medium     | Logging concerns            |
| **D**enial of Service      | Low        | Body size limits            |
| **E**levation of Privilege | Low        | VS Code sandbox             |

---

## Document Information

| Field          | Value      |
| -------------- | ---------- |
| Version        | 1.0        |
| Date           | 2024-01-XX |
| Classification | Internal   |
| Review Cycle   | Quarterly  |

---

_This security analysis was generated by automated code review tools and should be verified by security professionals before making enterprise deployment decisions._
