import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateTenantUseCase } from './create-tenant.use-case.js';
import type { Kysely } from 'kysely';
import type { Database } from '../../../../shared/infra/db/schema.js';
import type { CreateTenantCommand } from '../../domain/platform-admin.types.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';

// Mock password hasher
vi.mock('../../../identity/auth/password.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed-password')
}));

describe('CreateTenantUseCase', () => {
  let dbMock: any;
  let trxMock: any;

  beforeEach(() => {
    trxMock = {
      insertInto: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
      selectFrom: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue({ id: 'plan-id' })
    };

    dbMock = {
      selectFrom: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(null), // Default: no user/tenant exists
      insertInto: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
      transaction: vi.fn().mockReturnValue({
        execute: vi.fn(async (cb) => {
          await cb(trxMock);
        })
      })
    };
  });

  it('should create a RESTAURANT tenant with proper default values', async () => {
    const useCase = new CreateTenantUseCase(dbMock as unknown as Kysely<Database>);

    const command: CreateTenantCommand = {
      email: 'owner@restaurant.com',
      password: 'password123',
      tenant_name: 'RestoBar',
      tenant_business_name: 'RestoBar SAS',
      tenant_document_type: 'NIT',
      tenant_document_number: '900123456',
      name: 'Owner',
      tax_mode: 'IVA',
      plan: 'STARTER',
      business_type: 'RESTAURANT'
    };

    const result = await useCase.execute(command, 'actor-123', 'admin@platform.com');

    expect(result).toBeDefined();

    // Verify tenant insert payload
    const tenantInsertValues = trxMock.values.mock.calls.find((call: any) =>
      call[0] && call[0].name === 'RestoBar'
    )[0];

    expect(tenantInsertValues).toMatchObject({
      business_type: 'RESTAURANT',
      custom_business_type: null,
      enable_tables: false // Even for RESTAURANT, enable_tables is false because it's native
    });
  });

  it('should create an OTHER tenant with custom business type and enable_tables', async () => {
    const useCase = new CreateTenantUseCase(dbMock as unknown as Kysely<Database>);

    const command: CreateTenantCommand = {
      email: 'owner@spa.com',
      password: 'password123',
      tenant_name: 'My Spa',
      tenant_business_name: 'My Spa SAS',
      tenant_document_type: 'NIT',
      tenant_document_number: '900987654',
      name: 'Spa Owner',
      tax_mode: 'IVA',
      plan: 'STARTER',
      business_type: 'OTHER',
      custom_business_type: 'Spa',
      enable_tables: true
    };

    await useCase.execute(command, 'actor-123', 'admin@platform.com');

    // Verify tenant insert payload
    const tenantInsertValues = trxMock.values.mock.calls.find((call: any) =>
      call[0] && call[0].name === 'My Spa'
    )[0];

    expect(tenantInsertValues).toMatchObject({
      business_type: 'OTHER',
      custom_business_type: 'Spa',
      enable_tables: true
    });
  });
});
