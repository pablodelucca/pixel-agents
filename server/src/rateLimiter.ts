/**
 * Simple in-memory rate limiter using a sliding window algorithm.
 * Designed for the HTTP server to prevent DoS from local processes.
 *
 * Security: SEC-007
 */

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, RateLimitBucket>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Create a rate limiter.
   * @param maxRequestsPerWindow Maximum requests allowed per time window
   * @param windowMs Time window in milliseconds
   */
  constructor(maxRequestsPerWindow: number = 100, windowMs: number = 1000) {
    this.maxRequests = maxRequestsPerWindow;
    this.windowMs = windowMs;

    // Cleanup old buckets every minute to prevent memory leaks
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Check if a request should be allowed.
   * @param key Unique identifier (e.g., provider ID)
   * @returns true if allowed, false if rate limited
   */
  isAllowed(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    // Create new bucket or reset expired bucket
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }

    // Check if limit exceeded
    if (bucket.count >= this.maxRequests) {
      return false;
    }

    // Increment count and allow
    bucket.count++;
    return true;
  }

  /**
   * Get remaining requests in current window.
   * @param key Unique identifier
   * @returns Number of remaining requests
   */
  getRemaining(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= Date.now()) {
      return this.maxRequests;
    }
    return Math.max(0, this.maxRequests - bucket.count);
  }

  /**
   * Get the configured limit.
   * @returns Maximum requests per window
   */
  getLimit(): number {
    return this.maxRequests;
  }

  /**
   * Clean up expired buckets.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }

  /**
   * Dispose of the rate limiter and clean up resources.
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.buckets.clear();
  }
}
