export function computeBackoffDelayMs(
  attemptNumber: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exponent = Math.max(0, attemptNumber - 1);
  const delay = baseDelayMs * 2 ** exponent;
  return Math.min(maxDelayMs, delay);
}

export function computeNextRetryAt(
  attemptNumber: number,
  now: Date,
  baseDelayMs: number,
  maxDelayMs: number
): Date {
  const delayMs = computeBackoffDelayMs(attemptNumber, baseDelayMs, maxDelayMs);
  return new Date(now.getTime() + delayMs);
}
