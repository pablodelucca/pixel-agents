# Security Issue: SEC-012 - Debug Logging Configuration

## Finding Details

| Field | Value |
|-------|-------|
| **Finding ID** | SEC-012 |
| **Severity** | Informational |
| **Category** | Configuration |
| **Status** | Open |
| **Priority** | P3 - Long-term (within 90 days) |

## Description

Debug logging is controlled by the `PIXEL_AGENTS_DEBUG` environment variable, but the current implementation uses opt-out semantics (`!== '0'`) rather than opt-in (`=== '1'`). This means debug logging is enabled by default unless explicitly disabled.

### Current Implementation

```typescript
// server/src/hookEventHandler.ts:12
const debug = process.env.PIXEL_AGENTS_DEBUG !== '0';

// src/fileWatcher.ts:26
const debug = process.env.PIXEL_AGENTS_DEBUG !== '0';

// src/transcriptParser.ts:4
const debug = process.env.PIXEL_AGENTS_DEBUG !== '0';
```

### Issue

The condition `!== '0'` means:
- `PIXEL_AGENTS_DEBUG=0` → debug OFF ✅
- `PIXEL_AGENTS_DEBUG=1` → debug ON ✅
- `PIXEL_AGENTS_DEBUG` not set → debug ON ⚠️ (should be OFF)

For production/enterprise deployments, debug should be opt-in.

## Affected Files

- `server/src/hookEventHandler.ts:12`
- `src/fileWatcher.ts:26`
- `src/transcriptParser.ts:4`

## Risk Assessment

### Impact
- **Confidentiality**: Low - Debug logs may contain sensitive info
- **Integrity**: None
- **Availability**: None

### Overall Risk
Informational - This is a best practice issue, not a direct vulnerability.

## Remediation Steps

### Option 1: Simple Fix (Change to Opt-In)

```typescript
// All affected files
const debug = process.env.PIXEL_AGENTS_DEBUG === '1';
```

### Option 2: Centralized Debug Configuration (Recommended)

Create a shared debug module:

```typescript
// shared/debug.ts
export const isDebugEnabled = (): boolean => {
  // Check environment variable
  if (process.env.PIXEL_AGENTS_DEBUG === '1') return true;
  if (process.env.PIXEL_AGENTS_DEBUG === '0') return false;
  
  // Default: OFF in production, ON in development
  // Note: VS Code extension mode check would go here
  return false;
};

// Memoize the result
let _isDebug: boolean | undefined;
export const debug = (): boolean => {
  if (_isDebug === undefined) {
    _isDebug = isDebugEnabled();
  }
  return _isDebug;
};
```

Update all usage:
```typescript
// server/src/hookEventHandler.ts
import { debug } from '../../shared/debug.js';

if (debug()) {
  console.log(`[Pixel Agents] Hook: ...`);
}
```

### Option 3: Integrate with Logger (Best - Combines with SEC-003)

If implementing the logger from SEC-003:

```typescript
// src/logger.ts
import { LogLevel, logger } from './logger';

// Initialize based on environment
const debugEnv = process.env.PIXEL_AGENTS_DEBUG;
if (debugEnv === '1') {
  logger.setLevel(LogLevel.DEBUG);
} else if (debugEnv === '0') {
  logger.setLevel(LogLevel.WARN);
}
// Default is INFO (not DEBUG)
```

## Acceptance Criteria

- [ ] Debug mode is opt-in (requires explicit `PIXEL_AGENTS_DEBUG=1`)
- [ ] All debug flag checks use consistent logic
- [ ] Default behavior (no env var) is non-debug mode
- [ ] Documentation updated for debug mode usage
- [ ] `docs/SECURITY_ANALYSIS.md` updated to mark as resolved

## Testing Requirements

1. **Manual Testing**
   - Without env var: verify minimal logging
   - With `PIXEL_AGENTS_DEBUG=1`: verify debug logging
   - With `PIXEL_AGENTS_DEBUG=0`: verify no debug logging

## Related Issues

- SEC-003: Sensitive Data Exposure in Logs (implement together)

---

**Labels**: `security`, `compliance`, `priority: low`, `good first issue`
