import { describe, expect, it } from 'vitest';
import {
  tenantProfileSchema,
  updateTenantBusinessProfileBodySchema
} from '../src/schemas/tenant-profile.js';

describe('tenant profile schemas', () => {
  it('accepts the commercial business profile contract', () => {
    const parsed = tenantProfileSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Tenant Demo',
      nit: '900123123-7',
      businessName: 'Comercio Demo SAS',
      address: 'Calle 10 # 20-30',
      phone: '6011234567',
      footerMessage: 'Gracias por su compra',
      taxMode: 'IVA',
      businessType: null,
      createdAt: new Date().toISOString()
    });

    expect(parsed.success).toBe(true);
  });

  it('allows clearing nullable commercial fields on update', () => {
    const parsed = updateTenantBusinessProfileBodySchema.safeParse({
      address: 'Cra 7 # 10-20',
      phone: null,
      footerMessage: null
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.phone).toBeNull();
      expect(parsed.data.footerMessage).toBeNull();
    }
  });
});
