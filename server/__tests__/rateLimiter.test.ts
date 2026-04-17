import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimiter } from '../src/rateLimiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    limiter?.dispose();
    vi.useRealTimers();
  });

  it('allows requests under the limit', () => {
    limiter = new RateLimiter(10, 1000);
    for (let i = 0; i < 10; i++) {
      expect(limiter.isAllowed('test')).toBe(true);
    }
  });

  it('blocks requests over the limit', () => {
    limiter = new RateLimiter(10, 1000);
    // Use up all allowed requests
    for (let i = 0; i < 10; i++) {
      limiter.isAllowed('test');
    }
    // 11th request should be blocked
    expect(limiter.isAllowed('test')).toBe(false);
  });

  it('resets after window expires', () => {
    limiter = new RateLimiter(10, 1000);
    // Use up all requests
    for (let i = 0; i < 10; i++) {
      limiter.isAllowed('test');
    }
    expect(limiter.isAllowed('test')).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(1001);

    // Should be allowed again
    expect(limiter.isAllowed('test')).toBe(true);
  });

  it('tracks different keys independently', () => {
    limiter = new RateLimiter(5, 1000);
    // Use up requests for 'alice'
    for (let i = 0; i < 5; i++) {
      limiter.isAllowed('alice');
    }
    expect(limiter.isAllowed('alice')).toBe(false);

    // 'bob' should still have full quota
    expect(limiter.isAllowed('bob')).toBe(true);
  });

  it('returns correct remaining count', () => {
    limiter = new RateLimiter(10, 1000);
    expect(limiter.getRemaining('test')).toBe(10);

    limiter.isAllowed('test');
    expect(limiter.getRemaining('test')).toBe(9);

    for (let i = 0; i < 9; i++) {
      limiter.isAllowed('test');
    }
    expect(limiter.getRemaining('test')).toBe(0);
  });

  it('returns limit value', () => {
    limiter = new RateLimiter(100, 1000);
    expect(limiter.getLimit()).toBe(100);
  });

  it('cleans up expired buckets', () => {
    limiter = new RateLimiter(10, 1000);
    limiter.isAllowed('test1');
    limiter.isAllowed('test2');

    // Advance time past the window
    vi.advanceTimersByTime(1001);

    // Advance past cleanup interval (60 seconds)
    vi.advanceTimersByTime(60000);

    // Buckets should be cleaned up, and fresh requests allowed
    expect(limiter.getRemaining('test1')).toBe(10);
    expect(limiter.getRemaining('test2')).toBe(10);
  });

  it('dispose clears all state', () => {
    limiter = new RateLimiter(10, 1000);
    limiter.isAllowed('test');

    limiter.dispose();

    // After dispose, getRemaining should return max (empty state)
    expect(limiter.getRemaining('test')).toBe(10);
  });

  it('handles edge case with max requests of 1', () => {
    limiter = new RateLimiter(1, 100);
    expect(limiter.isAllowed('test')).toBe(true);
    expect(limiter.isAllowed('test')).toBe(false);

    vi.advanceTimersByTime(101);
    expect(limiter.isAllowed('test')).toBe(true);
  });

  it('handles rapid bursts correctly', () => {
    limiter = new RateLimiter(100, 1000);
    // Simulate rapid burst of 100 requests at once
    for (let i = 0; i < 100; i++) {
      expect(limiter.isAllowed('burst')).toBe(true);
    }
    // 101st should fail
    expect(limiter.isAllowed('burst')).toBe(false);

    // Other keys should be unaffected
    expect(limiter.isAllowed('other')).toBe(true);
  });
});
