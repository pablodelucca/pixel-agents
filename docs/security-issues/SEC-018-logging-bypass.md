# Security Issue: SEC-018 - Incomplete SEC-003 Remediation: Direct Console Logging Bypasses Structured Logger

## Finding Details

| Field | Value |
|-------|-------|
| **Finding ID** | SEC-018 |
| **Severity** | Medium |
| **CVSS Score** | 4.5 (estimated) |
| **Category** | Information Disclosure |
| **Status** | ✅ Resolved |
| **Priority** | P1 - Immediate (within 7 days) |
| **Resolution Date** | 2026-04-24 |
| **Related Finding** | SEC-003 (Sensitive Data Exposure in Logs) |

## Description

While SEC-003 introduced a structured `logger` module to sanitize sensitive data in log output, three source files were missed in that remediation and continued to call `console.error` / `console.warn` directly:

| File | Lines | Calls |
|------|-------|-------|
| `src/configPersistence.ts` | 19, 36 | `console.error` |
| `src/schemas/config.ts` | 41, 63 | `console.warn`, `console.error` |
| `src/schemas/layout.ts` | 83, 104 | `console.warn`, `console.error` |

These direct calls bypass all three protections that SEC-003 put in place:

1. **Path sanitization** – the home directory in file paths is not replaced with `~`. Error objects may include the full `~/.pixel-agents/config.json` path.
2. **Log-level control** – output is always emitted regardless of the configured `PIXEL_AGENTS_LOG_LEVEL`, breaking the production-mode `WARN`-only guarantee.
3. **Session-ID redaction** – any UUID that appears in error messages is not partially redacted.

## Affected Files

- `src/configPersistence.ts` – `readConfig()` and `writeConfig()` error handlers
- `src/schemas/config.ts` – `validateConfig()` and `parseConfig()` error handlers
- `src/schemas/layout.ts` – `validateLayout()` and `parseLayout()` error handlers

## Risk Assessment

### Impact
- **Confidentiality**: Medium – home-directory paths containing usernames, project names, and session IDs can appear in logs without sanitization
- **Integrity**: Low – no direct impact
- **Availability**: Low – no direct impact

### Likelihood
- **Exploitability**: Low – requires log access (e.g., enterprise centralized logging, shared dev machines, screen sharing)
- **Attack Vector**: Local / informational disclosure

### Potential Exposure Scenarios
1. **Enterprise Logging** – centralized log aggregators capture unsanitized home-directory paths
2. **Screen Sharing / Bug Reports** – users inadvertently share terminal output containing full paths
3. **Shared Development Machines** – teammates can see each other's home-directory structure

### Overall Risk
Medium – consistent with the original SEC-003 classification; the gap is an incomplete fix rather than a new class of vulnerability.

## Resolution Summary

All six direct `console.*` calls were replaced with the corresponding `logger.*` calls:

1. **`src/configPersistence.ts`** – imported `logger` from `./logger.js`; replaced both `console.error` calls with `logger.error`.
2. **`src/schemas/config.ts`** – imported `logger` from `../logger.js`; replaced `console.warn` with `logger.warn` and `console.error` with `logger.error`.
3. **`src/schemas/layout.ts`** – imported `logger` from `../logger.js`; replaced `console.warn` with `logger.warn` and `console.error` with `logger.error`.

## Acceptance Criteria

- [x] `src/configPersistence.ts` uses `logger.error` instead of `console.error`
- [x] `src/schemas/config.ts` uses `logger.warn` / `logger.error` instead of `console.*`
- [x] `src/schemas/layout.ts` uses `logger.warn` / `logger.error` instead of `console.*`
- [x] No remaining `console.error` / `console.warn` calls in `src/` outside of `src/logger.ts`
- [x] All existing tests continue to pass
- [x] Documentation updated in `docs/SECURITY_ANALYSIS.md` and `docs/security-issues/README.md`

## Testing Requirements

1. **Automated Testing**
   - All existing unit and integration tests pass (no regressions)

2. **Manual Testing**
   - Set `PIXEL_AGENTS_LOG_LEVEL=NONE`; corrupt `~/.pixel-agents/config.json`; confirm no output appears in the VS Code console
   - Set `PIXEL_AGENTS_LOG_LEVEL=DEBUG`; verify the error is logged with the home directory replaced by `~`

## References

- [SEC-003: Sensitive Data Exposure in Logs](SEC-003-sensitive-data-in-logs.md)
- [CWE-532: Insertion of Sensitive Information into Log File](https://cwe.mitre.org/data/definitions/532.html)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)

---

**Labels**: `security`, `compliance`, `priority: medium`, `logging`
