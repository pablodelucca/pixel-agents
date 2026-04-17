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

| Component | Technology | Security Boundary |
|-----------|------------|-------------------|
| Extension Backend | Node.js, VS Code API | VS Code Extension Host |
| HTTP Server | Node.js `http` module | localhost only (127.0.0.1) |
| Webview Frontend | React, TypeScript | VS Code Webview Sandbox |
| File Watchers | Node.js `fs` module | Local filesystem |
| Hook Script | Node.js | Claude Code process |

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

| Finding ID | Severity | Category | CVSS (Est.) | Status |
|------------|----------|----------|-------------|--------|
| SEC-001 | Medium | Input Validation | 5.5 | Resolved |
| SEC-002 | Medium | Path Traversal | 5.0 | Mitigated |
| SEC-003 | Medium | Information Disclosure | 4.5 | Open |
| SEC-004 | Medium | Insufficient CSP | 4.0 | Open |
| SEC-005 | Low | Token Exposure | 3.5 | Mitigated |
| SEC-006 | Low | Insecure File Permissions | 3.0 | Mitigated |
| SEC-007 | Low | Missing Rate Limiting | 3.0 | Open |
| SEC-008 | Low | Error Information Leakage | 2.5 | Open |
| SEC-009 | Low | Unvalidated Redirects | 2.0 | Open |
| SEC-010 | Low | Dependency Versions | 2.0 | Monitored |
| SEC-011 | Low | Missing Input Length Limits | 2.0 | Partial |
| SEC-012 | Info | Console Logging | 1.0 | Open |
| SEC-013 | Info | Debug Mode | 1.0 | Open |
| SEC-014 | Info | External Asset Loading | 1.0 | Open |
| SEC-015 | Info | Missing Security Headers | 1.0 | N/A |
| SEC-016 | Info | CORS Not Configured | 1.0 | N/A |

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

### SEC-003: Sensitive Data Exposure in Logs (Medium)

**Location**: Multiple files throughout codebase

**Description**: The extension logs detailed diagnostic information including file paths, session IDs, and project directories to the console.

**Code Example**:
```typescript
// src/agentManager.ts:31
console.log(`[Pixel Agents] Terminal: Project dir: ${workspacePath} → ${dirName}`);

// src/agentManager.ts:138
console.log(`[Pixel Agents] Terminal: Agent ${id} - created for terminal ${terminal.name}`);
```

**Risk**: In shared or logged environments, these messages could expose:
- User home directory paths
- Project structures
- Session identifiers
- File system layout

**Recommendation**:
- Implement log levels (debug, info, warn, error)
- Disable verbose logging in production builds
- Sanitize paths in log messages
- Add configuration option to disable logging

---

### SEC-004: Missing Content Security Policy (Medium)

**Location**: `src/PixelAgentsViewProvider.ts` (webview configuration)

**Description**: No explicit Content Security Policy (CSP) is configured for the webview. VS Code provides default CSP restrictions, but explicit configuration is best practice.

**Code Example**:
```typescript
// src/PixelAgentsViewProvider.ts:333
webviewView.webview.options = { enableScripts: true };
// No CSP meta tag in webview HTML
```

**Risk**: While VS Code sandboxes webviews, an explicit CSP would provide defense-in-depth against XSS attacks if vulnerabilities exist in the React application.

**Recommendation**:
- Add explicit CSP headers using `webview.cspSource`
- Restrict script sources to `'self'` and necessary VS Code sources
- Disallow inline scripts if possible

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

### SEC-007: Missing Rate Limiting on HTTP Server (Low)

**Location**: `server/src/server.ts`

**Description**: The HTTP server does not implement rate limiting. While it only listens on localhost, a malicious local process could flood it with requests.

**Risk**: Denial of service attack from local processes.

**Recommendation**:
- Implement simple rate limiting (e.g., max 100 requests/second per session)
- Add connection timeout (currently 5 seconds - good)
- Consider request queue limits

---

### SEC-008: Error Information Leakage (Low)

**Location**: Multiple error handling locations

**Description**: Some error messages may leak internal implementation details.

**Code Example**:
```typescript
// server/src/server.ts:167-169
res.writeHead(401);
res.end('unauthorized');
```

**Risk**: Error messages could help attackers understand system internals.

**Current Status**: Error messages are generally minimal - low risk.

---

### SEC-009: File URI Handling (Low)

**Location**: `src/PixelAgentsViewProvider.ts:723-724`

**Description**: The extension opens file URIs using VS Code's openExternal API.

**Code Example**:
```typescript
vscode.env.openExternal(vscode.Uri.file(projectDir));
```

**Risk**: While the projectDir is computed internally, this pattern could be exploited if user input is involved.

**Recommendation**: Ensure paths are always derived from trusted sources.

---

### SEC-010: Dependency Management (Low - Monitored)

**Location**: `package.json`, `webview-ui/package.json`, `server/package.json`

**Description**: Dependencies are managed with npm and automated updates via Dependabot.

**Positive Controls**:
- Dependabot enabled for weekly updates
- `npm audit` runs in CI at moderate level
- All dependencies are well-known, maintained packages

**Dependencies Summary**:
- React 19.2.0
- TypeScript 5.9.x
- esbuild 0.28.x
- Playwright 1.58.x (dev only)
- pngjs 7.0.0

**Recommendation**:
- Continue monitoring for vulnerabilities
- Consider using `npm audit --audit-level=high` for production builds
- Pin exact versions for production builds

---

### SEC-011: Input Length Validation (Low - Partial)

**Location**: `server/src/server.ts:182-193`

**Description**: The HTTP server implements body size limits.

**Code Example** (Control in place):
```typescript
const MAX_HOOK_BODY_SIZE = 65536; // 64KB limit

req.on('data', (chunk: Buffer) => {
  bodySize += chunk.length;
  if (bodySize > MAX_HOOK_BODY_SIZE && !responded) {
    responded = true;
    res.writeHead(413);
    res.end('payload too large');
    req.destroy();
    return;
  }
});
```

**Current Status**: PARTIAL - HTTP body limited, but JSONL line lengths could theoretically be very large.

---

### SEC-012: Debug Console Logging (Informational)

**Location**: Multiple files

**Description**: Debug logging is controlled by `PIXEL_AGENTS_DEBUG` environment variable.

**Code Example**:
```typescript
const debug = process.env.PIXEL_AGENTS_DEBUG !== '0';
```

**Note**: Debug mode is opt-out rather than opt-in in some places.

---

### SEC-013: Debug Mode in Webview (Informational)

**Location**: `webview-ui/src/App.tsx`

**Description**: Debug view can be toggled via settings modal.

**Risk**: Could expose internal state to observers.

---

### SEC-014: External Asset Directory Loading (Informational)

**Location**: `src/configPersistence.ts`, `src/assetLoader.ts`

**Description**: Users can configure external asset directories. While path traversal protection exists, this expands the trust boundary.

**Recommendation**: Consider enterprise policy options to restrict this feature.

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

2. **Configure Explicit CSP**
   - Add Content-Security-Policy to webview HTML
   - Use VS Code's `webview.cspSource` helper

### Short-Term Actions (Priority 2)

3. **Implement Structured Logging**
   - Add log levels with configuration
   - Sanitize sensitive data in logs
   - Disable debug logging in production

4. **Add Rate Limiting**
   - Implement simple rate limiting on HTTP server
   - Add connection pooling limits

### Long-Term Actions (Priority 3)

5. **Security Testing**
   - Add security-focused test cases
   - Consider fuzzing JSON parsers
   - Add path traversal test cases

6. **Enterprise Features**
   - Add policy configuration options
   - Allow disabling external asset directories
   - Add audit logging option

---

## Security Controls in Place

### Positive Security Controls

| Control | Location | Effectiveness |
|---------|----------|---------------|
| JSON Schema Validation (Zod) | src/schemas/*.ts | ✅ Good |
| Auth Token for HTTP API | server/src/server.ts | ✅ Good |
| Timing-Safe Token Comparison | server/src/server.ts:166 | ✅ Good |
| Localhost-Only HTTP Server | server/src/server.ts:84 | ✅ Good |
| File Permission Restrictions | server/src/server.ts:237,241 | ✅ Good |
| Path Traversal Prevention | src/assetLoader.ts:139-147 | ✅ Good |
| Body Size Limits | server/src/server.ts:182-193 | ✅ Good |
| Atomic File Writes | Multiple locations | ✅ Good |
| Provider ID Validation | server/src/server.ts:174 | ✅ Good |
| VS Code Webview Sandbox | Inherent | ✅ Good |
| No eval() or innerHTML with user data | Throughout codebase | ✅ Good |
| Dependabot Updates | .github/dependabot.yml | ✅ Good |
| npm audit in CI | .github/workflows/ci.yml | ✅ Good |
| Gitleaks Configuration | .gitleaks.toml | ✅ Good |
| TypeScript Strict Mode | tsconfig.json | ✅ Good |
| ESLint Security Rules | eslint.config.mjs | ⚠️ Partial |

### Security-Related CI Checks

- TypeScript type checking
- ESLint linting
- npm audit (moderate level)
- Dependabot automated updates

---

## Appendix A: Attack Surface Analysis

### External Attack Surface

| Entry Point | Protocol | Risk Level |
|-------------|----------|------------|
| Webview postMessage | VS Code IPC | Low |
| HTTP Hook Endpoint | HTTP (localhost) | Low |
| File System (JSONL) | Local FS | Low |
| File System (Config) | Local FS | Low |
| File System (Assets) | Local FS | Low |

### Internal Attack Surface

| Component | Risk Level | Notes |
|-----------|------------|-------|
| JSON Parsing | Medium | Multiple entry points |
| File I/O | Low | Restricted to known paths |
| Terminal Creation | Low | VS Code API sandboxed |

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

| Threat | Applicable | Mitigation |
|--------|------------|------------|
| **S**poofing | Low | Auth token for HTTP |
| **T**ampering | Medium | File integrity not verified |
| **R**epudiation | Low | Not applicable |
| **I**nformation Disclosure | Medium | Logging concerns |
| **D**enial of Service | Low | Body size limits |
| **E**levation of Privilege | Low | VS Code sandbox |

---

## Document Information

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Date | 2024-01-XX |
| Classification | Internal |
| Review Cycle | Quarterly |

---

*This security analysis was generated by automated code review tools and should be verified by security professionals before making enterprise deployment decisions.*
