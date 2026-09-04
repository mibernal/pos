import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, type AuthSession } from '../src/lib/api';
import { buildAuthUser } from './helpers/session-fixture';

const baseSession: AuthSession = {
  accessToken: 'token-123',
  user: buildAuthUser({ enableTables: true })
};

function buildClient(overrides?: Partial<Parameters<typeof createApiClient>[0]>) {
  return createApiClient({
    baseUrl: 'http://localhost:3000/api/v1',
    getSession: () => baseSession,
    setSession: vi.fn(),
    ...overrides
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  });
}

describe('api-client DIAN/product contract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends PATCH taxMode payload to tenant tax-profile endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        id: baseSession.user.tenantId,
        name: 'Tenant Demo',
        nit: '900123123',
        businessName: 'Comercio Demo SAS',
        address: 'Calle 10 # 20-30',
        phone: '6011234567',
        footerMessage: 'Gracias por tu compra',
        taxMode: 'INC_RESTAURANT',
        createdAt: new Date().toISOString()
      })
    );

    const client = buildClient();
    const result = await client.updateTenantTaxProfile(baseSession.user.tenantId!, 'INC_RESTAURANT');

    expect(result.taxMode).toBe('INC_RESTAURANT');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      `http://localhost:3000/api/v1/admin/tenants/${baseSession.user.tenantId}/tax-profile`
    );
    expect((init as RequestInit).method).toBe('PATCH');
    expect((init as RequestInit).body).toBe(JSON.stringify({ taxMode: 'INC_RESTAURANT' }));
  });

  it('sends business profile payload to the current tenant endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        id: baseSession.user.tenantId,
        name: 'Tenant Demo',
        nit: '900123123',
        businessName: 'Carnes Centro SAS',
        address: 'Cra 7 # 15-20',
        phone: '6011234567',
        footerMessage: 'Gracias por su compra',
        taxMode: 'IVA',
        createdAt: new Date().toISOString()
      })
    );

    const client = buildClient();
    const result = await client.updateTenantBusinessProfile({
      businessName: 'Carnes Centro SAS',
      nit: '900123123',
      address: 'Cra 7 # 15-20',
      phone: '6011234567',
      footerMessage: 'Gracias por su compra'
    });

    expect(result.address).toBe('Cra 7 # 15-20');
    expect(result.phone).toBe('6011234567');
    expect(result.footerMessage).toBe('Gracias por su compra');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://localhost:3000/api/v1/admin/tenants/current');
    expect((init as RequestInit).method).toBe('PATCH');
    expect((init as RequestInit).body).toBe(
      JSON.stringify({
        businessName: 'Carnes Centro SAS',
        nit: '900123123',
        address: 'Cra 7 # 15-20',
        phone: '6011234567',
        footerMessage: 'Gracias por su compra'
      })
    );
  });

  it('returns tenant taxMode from login responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        accessToken: 'token-cashier',
        tokenType: 'Bearer',
        expiresIn: '8h',
        user: {
          id: '55555555-5555-4555-8555-555555555555',
          tenantId: baseSession.user.tenantId,
          taxMode: 'INC_RESTAURANT',
          role: 'CASHIER',
          email: 'cashier@demo.posdian.local',
          name: 'Caja Uno',
          active: true,
          enableTables: true
        }
      })
    );

    const client = buildClient();
    const result = await client.login('cashier@demo.posdian.local', 'Cashier123*');

    expect(result.user!.taxMode).toBe('INC_RESTAURANT');
  });

  it('sends product taxCategory and price_cents when creating products', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        id: '33333333-3333-4333-8333-333333333333',
        tenantId: baseSession.user.tenantId,
        branchId: '44444444-4444-4444-8444-444444444444',
        name: 'Almuerzo ejecutivo',
        category: 'Platos',
        taxCategory: 'INC_8',
        barcode: null,
        price_cents: 32000,
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
    );

    const client = buildClient();
    await client.createProduct(
      {
        branchId: '44444444-4444-4444-8444-444444444444',
        name: 'Almuerzo ejecutivo',
        category: 'Platos',
        taxCategory: 'INC_8',
        barcode: null,
        price_cents: 32000,
        active: true
      },
      '44444444-4444-4444-8444-444444444444'
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).body).toBe(
      JSON.stringify({
        branchId: '44444444-4444-4444-8444-444444444444',
        name: 'Almuerzo ejecutivo',
        category: 'Platos',
        taxCategory: 'INC_8',
        barcode: null,
        price_cents: 32000,
        active: true
      })
    );
  });

  it('clears the persisted session when a protected request returns 401', async () => {
    const setSession = vi.fn();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ message: 'No autorizado' }, 401)
    );

    const client = buildClient({
      setSession
    });

    await expect(client.me()).rejects.toMatchObject({
      status: 401
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(setSession).toHaveBeenCalledWith(null);
  });
});

/**
 * La validación de sesión tiene plazo.
 *
 * Es la primera petición al abrir el POS y, mientras no conteste, la pantalla dice
 * «Validando sesión…». Un servidor que acepta la conexión y no responde —ocurrió: un Redis
 * mudo dejaba `/auth/refresh` colgado en la API— dejaba la caja ahí para siempre, sin
 * poder siquiera llegar al formulario de acceso. Vencido el plazo se trata como un fallo
 * de red, que es lo que `SessionProvider` ya sabe resolver enseñando el login.
 */
describe('validación de sesión al arrancar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('le pone plazo a /auth/refresh', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ accessToken: 'nuevo', user: baseSession.user }));

    await buildClient().refresh();

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('un servidor que no contesta se resuelve como fallo de red, no como espera eterna', async () => {
    // Es como aborta `AbortSignal.timeout`: rechazando la promesa de `fetch`.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    );

    await expect(buildClient().refresh()).rejects.toMatchObject({ isNetworkError: true });
  });
});
