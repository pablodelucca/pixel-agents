# Security Issue: SEC-011 - JSONL Input Length Validation

## Finding Details

| Field | Value |
|-------|-------|
| **Finding ID** | SEC-011 |
| **Severity** | Low |
| **CVSS Score** | 2.0 (estimated) |
| **Category** | Input Validation |
| **Status** | Partial |
| **Priority** | P3 - Long-term (within 90 days) |

## Description

While the HTTP server implements a 64KB body size limit, JSONL files read from disk have no maximum line length validation. A malicious or corrupted JSONL file with extremely long lines could cause:

1. Memory exhaustion when buffering lines
2. Performance degradation during parsing
3. Potential string handling issues

### Current Implementation

HTTP body limit (implemented):
```typescript
// server/src/server.ts:182-193
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

JSONL reading (no line limit):
```typescript
// src/fileWatcher.ts:182-194
const MAX_READ_BYTES = 65536;  // 64KB per read (good)
const bytesToRead = Math.min(stat.size - agent.fileOffset, MAX_READ_BYTES);
const buf = Buffer.alloc(bytesToRead);
// ...
const text = agent.lineBuffer + buf.toString('utf-8');
const lines = text.split('\n');
agent.lineBuffer = lines.pop() || '';  // Could grow unbounded

for (const line of lines) {
  if (!line.trim()) continue;
  processTranscriptLine(agentId, line, agents, ...);  // No length check
}
```

## Affected Files

- `src/fileWatcher.ts:182-212` - `readNewLines()` function

## Risk Assessment

### Impact
- **Confidentiality**: None
- **Integrity**: None
- **Availability**: Low - Potential memory exhaustion

### Likelihood
- **Exploitability**: Very Low - Requires crafting malicious JSONL files
- **Attack Vector**: Local file system

### Mitigating Factors
- Files are created by Claude Code, not user input
- 64KB read buffer limits single read
- String handling in modern V8 is robust

### Overall Risk
Low - Limited practical exploitation scenario.

## Remediation Steps

### Step 1: Add Line Length Limit

Update the file reading logic to enforce maximum line lengths:

```typescript
// src/fileWatcher.ts
const MAX_JSONL_LINE_LENGTH = 1_048_576; // 1MB max line length

export function readNewLines(
  agentId: number,
  agents: Map<number, AgentState>,
  // ...
): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  
  try {
    const stat = fs.statSync(agent.jsonlFile);
    if (stat.size <= agent.fileOffset) return;

    const MAX_READ_BYTES = 65536;
    const bytesToRead = Math.min(stat.size - agent.fileOffset, MAX_READ_BYTES);
    const buf = Buffer.alloc(bytesToRead);
    const fd = fs.openSync(agent.jsonlFile, 'r');
    fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
    fs.closeSync(fd);
    agent.fileOffset += bytesToRead;

    const text = agent.lineBuffer + buf.toString('utf-8');
    const lines = text.split('\n');
    agent.lineBuffer = lines.pop() || '';

    // Safety check: truncate line buffer if it's getting too large
    if (agent.lineBuffer.length > MAX_JSONL_LINE_LENGTH) {
      console.warn(
        `[Pixel Agents] Agent ${agentId} - line buffer exceeded max length, truncating`
      );
      agent.lineBuffer = '';
      // Skip to end of file to avoid processing partial line
      agent.fileOffset = stat.size;
      return;
    }

    for (const line of lines) {
      if (!line.trim()) continue;
      
      // Skip lines that are too long
      if (line.length > MAX_JSONL_LINE_LENGTH) {
        console.warn(
          `[Pixel Agents] Agent ${agentId} - skipping line exceeding max length`
        );
        continue;
      }
      
      processTranscriptLine(agentId, line, agents, waitingTimers, permissionTimers, webview);
    }
  } catch (e) {
    // ... existing error handling
  }
}
```

### Step 2: Add Constant to Configuration

```typescript
// server/src/constants.ts
/** Maximum allowed JSONL line length in bytes */
export const MAX_JSONL_LINE_LENGTH = 1_048_576; // 1MB
```

### Step 3: Add Line Buffer Limit to Agent State

Optionally track buffer growth:

```typescript
// src/types.ts
export interface AgentState {
  // ... existing fields
  lineBufferWarningCount: number;  // Track truncation events
}
```

## Acceptance Criteria

- [ ] Maximum line length constant defined
- [ ] Line buffer size checked before appending
- [ ] Oversized lines logged and skipped
- [ ] Line buffer truncated if it exceeds limit
- [ ] File offset advanced to skip corrupted data
- [ ] Warning logged for truncation events
- [ ] Unit tests added for edge cases
- [ ] No regression in normal JSONL processing
- [ ] `docs/SECURITY_ANALYSIS.md` updated to mark as resolved

## Testing Requirements

1. **Unit Tests**
   - Test with lines at max length (should process)
   - Test with lines over max length (should skip)
   - Test with line buffer growing beyond limit (should truncate)

2. **Manual Testing**
   - Create a test JSONL file with very long lines
   - Verify extension handles it gracefully
   - Verify no memory issues

## References

- [CWE-400: Uncontrolled Resource Consumption](https://cwe.mitre.org/data/definitions/400.html)

---

**Labels**: `security`, `compliance`, `priority: low`
