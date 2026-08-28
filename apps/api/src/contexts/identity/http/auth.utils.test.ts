import { describe, it, expect, vi } from 'vitest';
import {
  parseExpiryToMs,
  getUserBranchIds,
  generateRefreshToken,
  setRefreshTokenCookie,
  buildUserDto,
  buildAuthResponse,
  getUserForAuth
} from './auth.utils.js';

describe('auth.utils', () => {
  describe('parseExpiryToMs', () => {
    it('parses days correctly', () => {
      expect(parseExpiryToMs('7d')).toBe(7 * 24 * 60 * 60 * 1000);
    });
    it('parses hours correctly', () => {
      expect(parseExpiryToMs('12h')).toBe(12 * 60 * 60 * 1000);
    });
    it('parses minutes correctly', () => {
      expect(parseExpiryToMs('30m')).toBe(30 * 60 * 1000);
    });
    it('returns default 7 days for invalid format', () => {
      expect(parseExpiryToMs('invalid')).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe('getUserBranchIds', () => {
    it('returns empty array if tenantId is null', async () => {
      const result = await getUserBranchIds({} as any, 'user1', null);
      expect(result).toEqual([]);
    });

    it('executes db query and returns branch ids', async () => {
      const mockExecute = vi.fn().mockResolvedValue([{ branch_id: 'b1' }, { branch_id: 'b2' }]);
      const mockWhere = vi.fn().mockReturnValue({ execute: mockExecute });
      const mockSelect = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ where: mockWhere }) });
      const db = { selectFrom: vi.fn().mockReturnValue({ select: mockSelect }) };

      const result = await getUserBranchIds(db as any, 'user1', 'tenant1');
      expect(result).toEqual(['b1', 'b2']);
      expect(db.selectFrom).toHaveBeenCalledWith('user_branches');
    });
  });

  describe('generateRefreshToken', () => {
    it('generates random token and hash', () => {
      const result = generateRefreshToken('7d');
      expect(result.refreshTokenRaw).toBeDefined();
      expect(result.refreshTokenRaw.length).toBe(64); // 32 bytes hex = 64 chars
      expect(result.refreshTokenHash).toBeDefined();
      expect(result.expMs).toBe(7 * 24 * 60 * 60 * 1000);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('setRefreshTokenCookie', () => {
    it('sets cookie with correct attributes', () => {
      const mockReply = { setCookie: vi.fn() };
      setRefreshTokenCookie(mockReply as any, 'raw-token', 3600000, true);
      expect(mockReply.setCookie).toHaveBeenCalledWith('pos_refresh_token', 'raw-token', {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 3600
      });
    });
  });

  describe('buildUserDto', () => {
    it('builds a standardized user dto', () => {
      const user = { id: '1', tenant_id: 't1', tenant_plan: 'STARTER', tax_mode: 'IVA', role: 'ADMIN', email: 'a@a.com', name: 'A', active: true };
      const dto = buildUserDto(user, ['b1'], ['READ'], false);
      expect(dto).toMatchObject({
        id: '1',
        tenantId: 't1',
        tenantPlan: 'STARTER',
        taxMode: 'IVA',
        role: 'ADMIN',
        email: 'a@a.com',
        name: 'A',
        active: true,
        branchIds: ['b1'],
        permissions: ['READ'],
        isPlatformRole: false
      });

      // Los feature flags se resuelven a partir del tenant: sin valores en la fila,
      // todo queda apagado salvo el conteo de comensales, que es opt-out.
      const flagEntries = Object.entries(dto).filter(([key]) => key.startsWith('enable'));
      expect(flagEntries.length).toBeGreaterThan(0);
      for (const [key, value] of flagEntries) {
        expect({ [key]: value }).toEqual({ [key]: key === 'enableGuestsCount' });
      }
    });
  });

  describe('buildAuthResponse', () => {
    it('builds auth response and signs jwt', async () => {
      const jwt = { sign: vi.fn().mockResolvedValue('jwt-token') };
      const user = { id: '1', tenant_id: 't1', tenant_plan: 'STARTER', tax_mode: 'IVA', role: 'ADMIN', email: 'a@a.com', name: 'A', active: true };
      
      const response = await buildAuthResponse(jwt as any, user, ['b1'], ['READ'], false, '1h', { extra: 'val' });
      
      expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({
        sub: '1',
        userId: '1',
        extra: 'val'
      }), { expiresIn: '1h' });
      
      expect(response).toEqual({
        accessToken: 'jwt-token',
        tokenType: 'Bearer',
        expiresIn: '1h',
        user: expect.objectContaining({ id: '1' })
      });
    });
  });

  describe('getUserForAuth', () => {
    it('builds query to fetch user with tenant and subscriptions', async () => {
      const mockExecuteTakeFirst = vi.fn().mockResolvedValue({ id: 'user1' });
      const mockWhere = vi.fn().mockReturnValue({ executeTakeFirst: mockExecuteTakeFirst, where: vi.fn().mockReturnThis() });
      const db = {
        selectFrom: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          where: mockWhere,
        })
      };

      const result = await getUserForAuth(db as any, 'user1');
      expect(result).toEqual({ id: 'user1' });
    });
  });
});
