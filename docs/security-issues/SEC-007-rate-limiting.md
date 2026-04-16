# Security Issue: SEC-007 - Missing Rate Limiting on HTTP Server

## Finding Details

| Field | Value |
|-------|-------|
| **Finding ID** | SEC-007 |
| **Severity** | Low |
| **CVSS Score** | 3.0 (estimated) |
| **Category** | Configuration |
| **Status** | Open |
| **Priority** | P2 - Short-term (within 30 days) |

## Description

The HTTP server that receives hook events from Claude Code does not implement rate limiting. While the server only listens on localhost (127.0.0.1), a malicious or misbehaving local process could flood it with requests, potentially causing:

1. CPU exhaustion from processing requests
2. Memory exhaustion from buffered events
3. Delayed processing of legitimate hook events

### Current Implementation

```typescript
// server/src/server.ts
this.server = http.createServer((req, res) => {
  this.handleRequest(req, res);  // No rate limiting
});

this.server.setTimeout(5000);  // Good: 5-second timeout
this.server.listen(0, '127.0.0.1', () => { ... });  // Good: localhost only
```

### Existing Mitigations

- Server only listens on localhost (reduces attack surface)
- 5-second request timeout configured
- 64KB body size limit enforced
- Auth token required for hook endpoints

## Affected Files

- `server/src/server.ts:77-79` - Server creation
- `server/src/server.ts:129-153` - Request handling

## Risk Assessment

### Impact
- **Confidentiality**: None
- **Integrity**: None  
- **Availability**: Low-Medium - Local DoS possible

### Likelihood
- **Exploitability**: Low - Requires malicious local process
- **Attack Vector**: Local only

### Overall Risk
Low - Limited to local denial of service, with existing mitigations reducing likelihood.

## Remediation Steps

### Step 1: Implement Simple Rate Limiter

Create a rate limiting module:

```typescript
// server/src/rateLimiter.ts
interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, RateLimitBucket>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    maxRequestsPerWindow: number = 100,
    windowMs: number = 1000  // 1 second
  ) {
    this.maxRequests = maxRequestsPerWindow;
    this.windowMs = windowMs;
    
    // Cleanup old buckets every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Check if a request should be allowed.
   * @param key Unique identifier (e.g., session ID or IP)
   * @returns true if allowed, false if rate limited
   */
  isAllowed(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }

    if (bucket.count >= this.maxRequests) {
      return false;
    }

    bucket.count++;
    return true;
  }

  /**
   * Get remaining requests in current window.
   */
  getRemaining(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= Date.now()) {
      return this.maxRequests;
    }
    return Math.max(0, this.maxRequests - bucket.count);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }

  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.buckets.clear();
  }
}
```

### Step 2: Integrate into Server

Update the HTTP server to use rate limiting:

```typescript
// server/src/server.ts
import { RateLimiter } from './rateLimiter.js';

export class PixelAgentsServer {
  private rateLimiter = new RateLimiter(100, 1000); // 100 req/sec per session
  
  private handleHookRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: string,
  ): void {
    // ... auth validation ...

    // Rate limit by provider ID (or could use session from body)
    const providerId = url.slice(HOOK_API_PREFIX.length + 1);
    
    if (!this.rateLimiter.isAllowed(providerId)) {
      res.writeHead(429, {
        'Retry-After': '1',
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '0',
      });
      res.end('rate limited');
      return;
    }

    // Add rate limit headers to successful responses
    const remaining = this.rateLimiter.getRemaining(providerId);
    res.setHeader('X-RateLimit-Limit', '100');
    res.setHeader('X-RateLimit-Remaining', remaining.toString());

    // ... rest of handler ...
  }

  stop(): void {
    this.rateLimiter.dispose();
    // ... existing cleanup ...
  }
}
```

### Step 3: Add Configuration Constants

```typescript
// server/src/constants.ts
/** Maximum hook requests per second per provider */
export const RATE_LIMIT_MAX_REQUESTS = 100;

/** Rate limit window in milliseconds */
export const RATE_LIMIT_WINDOW_MS = 1000;
```

### Step 4: Add Global Connection Limit (Optional)

For additional protection, limit concurrent connections:

```typescript
private activeConnections = 0;
private readonly maxConnections = 50;

private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (this.activeConnections >= this.maxConnections) {
    res.writeHead(503);
    res.end('server busy');
    return;
  }
  
  this.activeConnections++;
  res.on('close', () => {
    this.activeConnections--;
  });
  
  // ... rest of handler ...
}
```

## Acceptance Criteria

- [ ] Rate limiter module implemented with configurable limits
- [ ] Hook endpoint returns 429 when rate limited
- [ ] Rate limit headers included in responses (`X-RateLimit-*`)
- [ ] `Retry-After` header included in 429 responses
- [ ] Rate limiter properly cleaned up on server stop
- [ ] Constants added for rate limit configuration
- [ ] Unit tests added for rate limiter
- [ ] No impact on normal operation (100 req/sec is generous)
- [ ] `docs/SECURITY_ANALYSIS.md` updated to mark as resolved

## Testing Requirements

1. **Unit Tests**
   ```typescript
   describe('RateLimiter', () => {
     it('allows requests under limit', () => {
       const limiter = new RateLimiter(10, 1000);
       for (let i = 0; i < 10; i++) {
         expect(limiter.isAllowed('test')).toBe(true);
       }
     });
     
     it('blocks requests over limit', () => {
       const limiter = new RateLimiter(10, 1000);
       for (let i = 0; i < 10; i++) {
         limiter.isAllowed('test');
       }
       expect(limiter.isAllowed('test')).toBe(false);
     });
     
     it('resets after window expires', async () => {
       const limiter = new RateLimiter(10, 100);
       for (let i = 0; i < 10; i++) {
         limiter.isAllowed('test');
       }
       await new Promise(r => setTimeout(r, 150));
       expect(limiter.isAllowed('test')).toBe(true);
     });
   });
   ```

2. **Integration Tests**
   - Verify 429 response when rate limited
   - Verify rate limit headers in responses

## References

- [OWASP Rate Limiting](https://cheatsheetseries.owasp.org/cheatsheets/Rate_Limiting_Cheat_Sheet.html)
- [CWE-770: Allocation of Resources Without Limits](https://cwe.mitre.org/data/definitions/770.html)

---

**Labels**: `security`, `compliance`, `priority: low`
