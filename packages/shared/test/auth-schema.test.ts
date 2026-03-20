import { describe, expect, it } from 'vitest';
import {
  authUserSchema,
  loginBodySchema,
  loginResponseSchema,
  meResponseSchema
} from '../src/schemas/auth.js';

describe('auth schemas', () => {
  it('accepts taxMode in the authenticated user contract', () => {
    const parsed = authUserSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      taxMode: 'INC_RESTAURANT',
      role: 'ADMIN',
      email: 'admin@demo.posdian.local',
      name: 'Admin Demo',
      active: true
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.taxMode).toBe('INC_RESTAURANT');
    }
  });

  it('keeps login and me responses compatible when taxMode is present', () => {
    const loginParsed = loginResponseSchema.safeParse({
      accessToken: 'token-123',
      tokenType: 'Bearer',
      expiresIn: '8h',
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
        taxMode: 'IVA',
        role: 'CASHIER',
        email: 'cashier@demo.posdian.local',
        name: 'Caja Uno',
        active: true
      }
    });

    const meParsed = meResponseSchema.safeParse({
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
        taxMode: 'IVA',
        role: 'CASHIER',
        email: 'cashier@demo.posdian.local',
        name: 'Caja Uno',
        active: true
      }
    });

    expect(loginParsed.success).toBe(true);
    expect(meParsed.success).toBe(true);
  });

  it('normalizes email and rejects unknown keys in login body', () => {
    const parsed = loginBodySchema.safeParse({
      email: '  ADMIN@DEMO.POSDIAN.LOCAL  ',
      password: 'Admin123*',
      unexpected: true
    });

    expect(parsed.success).toBe(false);

    const normalizedParsed = loginBodySchema.safeParse({
      email: '  ADMIN@DEMO.POSDIAN.LOCAL  ',
      password: 'Admin123*'
    });

    expect(normalizedParsed.success).toBe(true);
    if (normalizedParsed.success) {
      expect(normalizedParsed.data.email).toBe('admin@demo.posdian.local');
    }
  });
});
