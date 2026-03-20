import { env } from '../../app/env.js';

interface LoginRateLimitEntry {
  attempts: number;
  resetAtMs: number;
}

const loginAttempts = new Map<string, LoginRateLimitEntry>();

function getNowMs(now = Date.now()): number {
  return now;
}

function getOrCreateEntry(key: string, nowMs: number): LoginRateLimitEntry {
  const existingEntry = loginAttempts.get(key);
  if (!existingEntry || existingEntry.resetAtMs <= nowMs) {
    const freshEntry = {
      attempts: 0,
      resetAtMs: nowMs + env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS
    };
    loginAttempts.set(key, freshEntry);
    return freshEntry;
  }

  return existingEntry;
}

export function buildLoginRateLimitKey(ipAddress: string, normalizedEmail: string): string {
  return `${ipAddress}:${normalizedEmail}`;
}

export function assertLoginRateLimitAllowed(key: string, now = getNowMs()): void {
  const entry = getOrCreateEntry(key, now);
  if (entry.attempts < env.AUTH_LOGIN_RATE_LIMIT_MAX) {
    return;
  }

  throw new Error('LOGIN_RATE_LIMIT_EXCEEDED');
}

export function recordLoginRateLimitFailure(key: string, now = getNowMs()): void {
  const entry = getOrCreateEntry(key, now);
  entry.attempts += 1;
  loginAttempts.set(key, entry);
}

export function clearLoginRateLimit(key: string): void {
  loginAttempts.delete(key);
}

export function resetLoginRateLimitStore(): void {
  loginAttempts.clear();
}
