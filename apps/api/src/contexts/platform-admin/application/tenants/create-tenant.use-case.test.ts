import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateTenantUseCase } from './create-tenant.use-case.js';
import type { Kysely } from 'kysely';
import type { Database } from '../../../../shared/infra/db/schema.js';
import type { CreateTenantCommand } from '../../domain/platform-admin.types.js';

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
      // La siembra del catálogo de medios de pago inserta con `ON CONFLICT DO NOTHING`.
      onConflict: vi.fn().mockReturnThis(),
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
      // El caso de uso consulta, en este orden: usuario existente, comercio existente y el
      // plan. Los dos primeros deben salir vacíos; el tercero tiene que devolver un plan o
      // el alta se rechaza con 400 — que es exactamente lo que se corrigió: antes, no
      // encontrarlo se saltaba la suscripción en silencio.
      executeTakeFirst: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ id: 'STARTER', name: 'Plan Starter', price_cents: 4990000, billing_cycle: 'MONTHLY' }),
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
      // RESTAURANT es un tipo nativo de mesas: el módulo queda habilitado de entrada.
      enable_tables: true
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
