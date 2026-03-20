import { describe, expect, it } from 'vitest';
import { computeBackoffDelayMs, computeNextRetryAt } from '../src/outbox/backoff.js';

describe('outbox backoff', () => {
  it('grows exponentially by attempt number', () => {
    expect(computeBackoffDelayMs(1, 1000, 60000)).toBe(1000);
    expect(computeBackoffDelayMs(2, 1000, 60000)).toBe(2000);
    expect(computeBackoffDelayMs(3, 1000, 60000)).toBe(4000);
  });

  it('caps delay at max', () => {
    expect(computeBackoffDelayMs(20, 1000, 60000)).toBe(60000);
  });

  it('computes next retry date', () => {
    const now = new Date('2026-03-05T12:00:00.000Z');
    const next = computeNextRetryAt(2, now, 1000, 60000);

    expect(next.toISOString()).toBe('2026-03-05T12:00:02.000Z');
  });
});
