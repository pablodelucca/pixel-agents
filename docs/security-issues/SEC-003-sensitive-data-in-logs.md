# Security Issue: SEC-003 - Sensitive Data Exposure in Logs

## Finding Details

| Field | Value |
|-------|-------|
| **Finding ID** | SEC-003 |
| **Severity** | Medium |
| **CVSS Score** | 4.5 (estimated) |
| **Category** | Information Disclosure |
| **Status** | Open |
| **Priority** | P2 - Short-term (within 30 days) |

## Description

The extension logs detailed diagnostic information to the VS Code console, including:
- File paths containing user home directories
- Session identifiers
- Project directory structures
- Terminal names and indices
- Agent IDs and states

In shared or logged environments (enterprise logging systems, shared development machines, screen sharing sessions), these log messages could inadvertently expose sensitive information about the user's file system structure, project names, and session activity.

## Affected Files

Multiple files throughout the codebase use `console.log()` with potentially sensitive data:

- `src/agentManager.ts:31, 138, 165, 197, 219, etc.`
- `src/fileWatcher.ts:145-147, 514-516, etc.`
- `src/PixelAgentsViewProvider.ts:262, 417, 535-537, etc.`
- `src/transcriptParser.ts:113-116, 173-175, etc.`
- `src/assetLoader.ts:52-54, 69, 171-172, etc.`
- `server/src/server.ts:100, 244, etc.`
- `server/src/hookEventHandler.ts:163-164, 307-309, etc.`

### Code Examples

**Current Implementation (Verbose Logging):**
```typescript
// src/agentManager.ts:31
console.log(`[Pixel Agents] Terminal: Project dir: ${workspacePath} → ${dirName}`);

// src/agentManager.ts:138
console.log(`[Pixel Agents] Terminal: Agent ${id} - created for terminal ${terminal.name}`);

// src/fileWatcher.ts:145-147
console.log(
  `[Pixel Agents] Watcher: Agent ${agentId} - /clear detected, reassigning to ${path.basename(file)}`,
);

// server/src/hookEventHandler.ts:163-164
if (debug && tracked)
  console.log(`[Pixel Agents] Hook: SessionStart(source=${source}, session=${sid}...)`);
```

## Risk Assessment

### Impact
- **Confidentiality**: Medium - File paths, session IDs, and project structures exposed
- **Integrity**: Low - No direct impact
- **Availability**: Low - No direct impact

### Potential Exposure Scenarios
1. **Enterprise Logging**: Centralized logging systems may capture console output
2. **Screen Sharing**: Sensitive paths visible during demonstrations
3. **Bug Reports**: Users may inadvertently share logs containing sensitive info
4. **Shared Development**: Team members can see each other's paths

### Overall Risk
Medium - While not directly exploitable, information disclosure is a compliance concern for enterprise deployments.

## Remediation Steps

### Step 1: Implement Structured Logging Module

Create a centralized logging module with log levels:

```typescript
// src/logger.ts
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

interface LoggerConfig {
  level: LogLevel;
  sanitizePaths: boolean;
  prefix: string;
}

class Logger {
  private config: LoggerConfig = {
    level: LogLevel.INFO,
    sanitizePaths: true,
    prefix: '[Pixel Agents]',
  };

  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  setSanitizePaths(sanitize: boolean): void {
    this.config.sanitizePaths = sanitize;
  }

  private sanitize(message: string): string {
    if (!this.config.sanitizePaths) return message;
    
    // Replace home directory paths
    const homeDir = require('os').homedir();
    let sanitized = message.replace(new RegExp(homeDir, 'g'), '~');
    
    // Replace session UUIDs (keep first 8 chars for debugging)
    sanitized = sanitized.replace(
      /([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '$1-****-****-****-************'
    );
    
    return sanitized;
  }

  debug(...args: unknown[]): void {
    if (this.config.level <= LogLevel.DEBUG) {
      console.log(this.config.prefix, '[DEBUG]', ...args.map(a => 
        typeof a === 'string' ? this.sanitize(a) : a
      ));
    }
  }

  info(...args: unknown[]): void {
    if (this.config.level <= LogLevel.INFO) {
      console.log(this.config.prefix, '[INFO]', ...args.map(a => 
        typeof a === 'string' ? this.sanitize(a) : a
      ));
    }
  }

  warn(...args: unknown[]): void {
    if (this.config.level <= LogLevel.WARN) {
      console.warn(this.config.prefix, '[WARN]', ...args.map(a => 
        typeof a === 'string' ? this.sanitize(a) : a
      ));
    }
  }

  error(...args: unknown[]): void {
    if (this.config.level <= LogLevel.ERROR) {
      console.error(this.config.prefix, '[ERROR]', ...args.map(a => 
        typeof a === 'string' ? this.sanitize(a) : a
      ));
    }
  }
}

export const logger = new Logger();

// Initialize from environment
if (process.env.PIXEL_AGENTS_DEBUG === '0') {
  logger.setLevel(LogLevel.WARN);
} else if (process.env.PIXEL_AGENTS_DEBUG === '1') {
  logger.setLevel(LogLevel.DEBUG);
}
```

### Step 2: Add Configuration Option

Allow users to control logging through VS Code settings:

```json
// package.json contributes.configuration
{
  "pixel-agents.logging.level": {
    "type": "string",
    "default": "info",
    "enum": ["debug", "info", "warn", "error", "none"],
    "description": "Log level for Pixel Agents extension"
  },
  "pixel-agents.logging.sanitizePaths": {
    "type": "boolean",
    "default": true,
    "description": "Sanitize file paths in log messages"
  }
}
```

### Step 3: Update All Log Calls

Replace direct `console.log()` calls with the logger:

```typescript
// Before
console.log(`[Pixel Agents] Terminal: Project dir: ${workspacePath} → ${dirName}`);

// After
import { logger } from './logger';
logger.debug(`Terminal: Project dir: ${workspacePath} → ${dirName}`);
```

### Step 4: Production Build Configuration

Set appropriate defaults for production:

```typescript
// In extension.ts activation
if (context.extensionMode === vscode.ExtensionMode.Production) {
  logger.setLevel(LogLevel.WARN);
  logger.setSanitizePaths(true);
}
```

## Acceptance Criteria

- [ ] Logger module created with log levels (DEBUG, INFO, WARN, ERROR, NONE)
- [ ] Path sanitization implemented (replaces home directory with ~)
- [ ] Session ID sanitization implemented (partial redaction)
- [ ] All `console.log()` calls replaced with logger calls
- [ ] Log level configurable via VS Code settings
- [ ] Production builds default to WARN level
- [ ] Documentation added for logging configuration
- [ ] Debug documentation updated (Debug View instructions)
- [ ] `docs/SECURITY_ANALYSIS.md` updated to mark as resolved

## Testing Requirements

1. **Unit Tests**
   - Test path sanitization regex
   - Test session ID sanitization
   - Test log level filtering

2. **Manual Testing**
   - Verify logs are appropriately filtered at each level
   - Verify paths are sanitized in output
   - Verify debug mode still works for development

3. **Regression Testing**
   - Ensure Debug View still functions correctly
   - Ensure error reporting provides enough context for debugging

## References

- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [CWE-532: Insertion of Sensitive Information into Log File](https://cwe.mitre.org/data/definitions/532.html)

---

**Labels**: `security`, `compliance`, `priority: medium`
