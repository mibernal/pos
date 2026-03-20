import { describe, expect, it } from 'vitest';
import { parseCorsAllowedOrigins, resolveCorsAllowedOrigins } from '../src/app/cors.js';

describe('cors config', () => {
  it('uses localhost origins by default outside production', () => {
    expect(resolveCorsAllowedOrigins('development', undefined)).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173'
    ]);
  });

  it('parses and deduplicates configured origins', () => {
    expect(
      parseCorsAllowedOrigins(
        'https://pos.demo.com, https://pos.demo.com, http://localhost:5173'
      )
    ).toEqual(['https://pos.demo.com', 'http://localhost:5173']);
  });

  it('rejects configured origins with paths', () => {
    expect(() => parseCorsAllowedOrigins('https://pos.demo.com/app')).toThrow(
      'CORS origin must not include a path, query, or hash'
    );
  });
});
