const DEV_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'] as const;

function normalizeOrigin(origin: string): string {
  const parsed = new URL(origin);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported CORS origin protocol: ${origin}`);
  }

  if (parsed.origin !== origin) {
    throw new Error(`CORS origin must not include a path, query, or hash: ${origin}`);
  }

  return parsed.origin;
}

export function parseCorsAllowedOrigins(rawOrigins: string | undefined): string[] {
  if (!rawOrigins || rawOrigins.trim().length === 0) {
    return [];
  }

  return [...new Set(
    rawOrigins
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
      .map(normalizeOrigin)
  )];
}

export function resolveCorsAllowedOrigins(
  nodeEnv: 'development' | 'test' | 'production',
  rawOrigins: string | undefined
): string[] {
  const configuredOrigins = parseCorsAllowedOrigins(rawOrigins);
  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  if (nodeEnv === 'production') {
    return [];
  }

  return [...DEV_ALLOWED_ORIGINS];
}
