import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../src/app/App';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { addPendingSale, clearPendingSales } from '../src/lib/offline-queue';
import { writeAuthSession, writePosContext } from '../src/lib/session';
import { usePosStore } from '../src/hooks/usePosStore';

function normalizeText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function expectPendingCount(count: number) {
  const label = `${count} ${count === 1 ? 'pendiente' : 'pendientes'}`;

  expect(
    screen.getAllByText((_, node) => normalizeText(node?.textContent) === label).length
  ).toBeGreaterThan(0);
}

function seedSession(role: 'ADMIN' | 'CASHIER' = 'ADMIN') {
  writeAuthSession({
    accessToken: 'token-admin',
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      taxMode: role === 'ADMIN' ? 'INC_RESTAURANT' : 'IVA',
      role,
      email: 'admin@demo.posdian.local',
      name: 'Admin Demo',
      active: true
    }
  });

  const context = {
    branchId: '33333333-3333-4333-8333-333333333333',
    branchName: 'Sucursal Centro',
    branchAddress: 'Calle 1 # 2-3',
    cashSessionId: '44444444-4444-4444-8444-444444444444',
    terminalId: '55555555-5555-4555-8555-555555555555',
    terminalName: 'Caja 1'
  };
  writePosContext(context);
  usePosStore.setState({ posContext: context });
}

function mockAuthenticatedAppFetch(role: 'ADMIN' | 'CASHIER' = 'ADMIN') {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);

    if (url.endsWith('/auth/me')) {
      return new Response(
          JSON.stringify({
            user: {
              id: '11111111-1111-4111-8111-111111111111',
              tenantId: '22222222-2222-4222-8222-222222222222',
              taxMode: role === 'ADMIN' ? 'INC_RESTAURANT' : 'IVA',
              role,
              email: 'admin@demo.posdian.local',
              name: 'Admin Demo',
              active: true
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.endsWith('/auth/refresh')) {
      return new Response(
          JSON.stringify({
            accessToken: 'mock-token',
            user: {
              id: '11111111-1111-4111-8111-111111111111',
              tenantId: '22222222-2222-4222-8222-222222222222',
              taxMode: role === 'ADMIN' ? 'INC_RESTAURANT' : 'IVA',
              role,
              email: 'admin@demo.posdian.local',
              name: 'Admin Demo',
              active: true
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.includes('/products?')) {
      return new Response(
        JSON.stringify({
          items: [],
          page: {
            limit: 100,
            count: 0,
            hasMore: false
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.endsWith('/customers')) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (url.endsWith('/branches')) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              tenant_id: '22222222-2222-4222-8222-222222222222',
              name: 'Sucursal Centro',
              address: 'Calle 1 # 2-3',
              created_at: new Date().toISOString(),
              current_cash_session: null
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.includes('/terminals')) {
      return new Response(
        JSON.stringify({
          terminals: [
            {
              id: '55555555-5555-4555-8555-555555555555',
              name: 'Caja 1',
              is_active: true
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.endsWith('/admin/tenants/current')) {
      return new Response(
        JSON.stringify({
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Tenant Demo',
          nit: '900123123',
          businessName: 'Comercio Demo SAS',
          address: 'Calle 10 # 20-30',
          phone: '6011234567',
          footerMessage: 'Gracias por tu compra',
          taxMode: 'INC_RESTAURANT',
          createdAt: new Date().toISOString()
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ message: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' }
    });
  });
}

function buildCreatedSaleResponse(totalCents: number) {
  return {
    sale: {
      id: 'sale-sync-1',
      tenant_id: '22222222-2222-4222-8222-222222222222',
      branch_id: '33333333-3333-4333-8333-333333333333',
      cash_session_id: '44444444-4444-4444-8444-444444444444',
      sale_number: 44,
      status: 'COMPLETED' as const,
      subtotal_cents: totalCents,
      discount_cents: 0,
      total_cents: totalCents,
      tax_total_cents: 0,
      tax_lines_json: [],
      payment_json: {
        mode: 'CASH' as const,
        total_cents: totalCents,
        amounts: {
          cash_cents: totalCents,
          card_cents: 0,
          transfer_cents: 0
        },
        payments: [{ method: 'CASH' as const, amount_cents: totalCents }]
      },
      dian_status: 'PENDING' as const,
      created_by_user_id: '11111111-1111-4111-8111-111111111111',
      void_reason: null,
      voided_by_user_id: null,
      voided_at: null,
      created_at: new Date().toISOString()
    },
    items: []
  };
}

function buildPendingSalePayload(clientUuid: string) {
  return {
    client_uuid: clientUuid,
    branch_id: '33333333-3333-4333-8333-333333333333',
    cash_session_id: '44444444-4444-4444-8444-444444444444',
    discount_cents: 0,
    items: [
      {
        product_id: 'product-1',
        qty: 1,
        price_cents: 1500
      }
    ],
    payments: [
      {
        method: 'CASH' as const,
        amount_cents: 1500
      }
    ]
  };
}

function mockAuthenticatedPosFetch(options?: {
  onCreateSale?: (callNumber: number) => Promise<Response>;
}) {
  let saleCalls = 0;

  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);

    if (url.endsWith('/auth/me')) {
      return new Response(
        JSON.stringify({
          user: {
            id: '11111111-1111-4111-8111-111111111111',
            tenantId: '22222222-2222-4222-8222-222222222222',
            taxMode: 'IVA',
            role: 'ADMIN',
            email: 'admin@demo.posdian.local',
            name: 'Admin Demo',
            active: true
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.endsWith('/auth/refresh')) {
      return new Response(
        JSON.stringify({
          accessToken: 'mock-token',
          user: {
            id: '11111111-1111-4111-8111-111111111111',
            tenantId: '22222222-2222-4222-8222-222222222222',
            taxMode: 'IVA',
            role: 'ADMIN',
            email: 'admin@demo.posdian.local',
            name: 'Admin Demo',
            active: true
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.includes('/products?')) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'product-1',
              tenantId: '22222222-2222-4222-8222-222222222222',
              branchId: '33333333-3333-4333-8333-333333333333',
              name: 'Cafe Americano',
              category: 'Bebidas',
              taxCategory: 'IVA_19',
              barcode: '77010001',
              price_cents: 1500,
              active: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ],
          page: {
            limit: 120,
            count: 1,
            hasMore: false
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.endsWith('/customers')) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (url.endsWith('/branches')) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              tenant_id: '22222222-2222-4222-8222-222222222222',
              name: 'Sucursal Centro',
              address: 'Calle 1 # 2-3',
              created_at: new Date().toISOString(),
              current_cash_session: null
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.includes('/terminals')) {
      return new Response(
        JSON.stringify({
          terminals: [
            {
              id: '55555555-5555-4555-8555-555555555555',
              name: 'Caja 1',
              is_active: true
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.endsWith('/sales') && init?.method === 'POST') {
      saleCalls += 1;
      if (options?.onCreateSale) {
        return options.onCreateSale(saleCalls);
      }

      return new Response(JSON.stringify(buildCreatedSaleResponse(1500)), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ message: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' }
    });
  });
}

function mockLoginFlowFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);

    if (url.endsWith('/auth/login')) {
      const body = JSON.parse(String(init?.body)) as { email: string; password: string };

      if (body.email !== 'cashier@demo.posdian.local' || body.password !== 'Cashier123*') {
        return new Response(JSON.stringify({ message: 'Credenciales inválidas' }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response(
        JSON.stringify({
          accessToken: 'token-cashier',
          user: {
            id: '55555555-5555-4555-8555-555555555555',
            tenantId: '22222222-2222-4222-8222-222222222222',
            taxMode: 'IVA',
            role: 'CASHIER',
            email: 'cashier@demo.posdian.local',
            name: 'Caja Uno',
            active: true
          }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.endsWith('/branches')) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              tenant_id: '22222222-2222-4222-8222-222222222222',
              name: 'Sucursal Centro',
              address: 'Calle 1 # 2-3',
              created_at: new Date().toISOString(),
              current_cash_session: null
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.includes('/terminals')) {
      return new Response(
        JSON.stringify({
          terminals: [
            {
              id: '55555555-5555-4555-8555-555555555555',
              name: 'Caja 1',
              is_active: true
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.includes('/cash-sessions/current?')) {
      return new Response(JSON.stringify({ cash_session: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ message: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' }
    });
  });
}

describe('App', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    usePosStore.setState({ posContext: null });
    await clearPendingSales();
  });

  it('renders POS title', () => {
    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);
    expect(screen.getByRole('heading', { name: 'BIENVENIDO' })).toBeInTheDocument();
    expect(screen.getByLabelText('Correo Electrónico')).toBeInTheDocument();
  });

  it('logs in and loads branch setup when credentials are valid', async () => {
    mockLoginFlowFetch();

    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);

    fireEvent.change(screen.getByLabelText('Correo Electrónico'), {
      target: { value: 'cashier@demo.posdian.local' }
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), {
      target: { value: 'Cashier123*' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar Sesión' }));

    expect(await screen.findByRole('heading', { name: 'PUNTO DE VENTA' })).toBeInTheDocument();
  });

  it('redirects to login when a persisted session is no longer valid', async () => {
    seedSession();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'No autorizado' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      })
    );

    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);

    expect(await screen.findByLabelText('Correo Electrónico')).toBeInTheDocument();
    expect(screen.getByText(/tu sesión expiró/i)).toBeInTheDocument();
  });

  it('opens DIAN config modal for ADMIN and loads current tenant tax_mode', async () => {
    seedSession('ADMIN');
    mockAuthenticatedAppFetch('ADMIN');

    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);

    const openConfigButton = await screen.findByTitle('Configuración DIAN');
    fireEvent.click(openConfigButton);

    const dialog = await screen.findByRole('dialog', { name: 'Configurar DIAN' });

    const taxModeSelect = within(dialog).getByRole('combobox');
    await waitFor(() => {
      expect((taxModeSelect as HTMLSelectElement).value).toBe('INC_RESTAURANT');
    });

    expect(screen.getByText(/Comercio Demo SAS/i)).toBeInTheDocument();
    expect(screen.getByText(/Incluye INC/i)).toBeInTheDocument();
  });

  it('navigates to products screen through the internal router', async () => {
    seedSession('ADMIN');
    mockAuthenticatedAppFetch('ADMIN');

    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);

    const productsTab = await screen.findByRole('button', { name: 'Productos' });
    fireEvent.click(productsTab);

    expect(await screen.findByRole('heading', { name: 'Catálogo de Productos' })).toBeInTheDocument();
  });

  it('hides admin actions for cashier users', async () => {
    seedSession('CASHIER');
    mockAuthenticatedAppFetch('CASHIER');

    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);

    expect(screen.queryByRole('button', { name: 'Configuración DIAN' })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Productos' }));

    expect(
      await screen.findByText(/como cajero, puedes ver el catálogo pero no realizar modificaciones/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear producto' })).not.toBeInTheDocument();
  });

  it('queues the sale on network failure and syncs it when backend reports the same client_uuid', async () => {
    seedSession('ADMIN');

    const randomValues = ['11111111-2222-4333-8444-555555555555'];
    let randomIndex = 0;

    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation((() => {
      const nextValue = randomValues[randomIndex] ?? 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      randomIndex += 1;
      return nextValue;
    }) as any);

    mockAuthenticatedPosFetch({
      onCreateSale: async (callNumber) => {
        if (callNumber === 1) {
          throw new TypeError('Failed to fetch');
        }

        return new Response(
          JSON.stringify({
            error: {
              message: 'client_uuid already exists'
            }
          }),
          { status: 409, headers: { 'content-type': 'application/json' } }
        );
      }
    });

    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);

    await screen.findByRole('button', { name: /agregar destacado/i });
    fireEvent.keyDown(await screen.findByLabelText('Búsqueda rápida'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /cobrar/i }));

    const checkoutDialog = screen.getByRole('dialog', { name: 'Cobrar venta' });
    fireEvent.change(screen.getByLabelText('Recibido (COP)'), {
      target: { value: '20' }
    });
    fireEvent.click(within(checkoutDialog).getByRole('button', { name: /confirmar cobro/i }));

    expect(
      await screen.findByText(/venta guardada como pendiente por falta de conexión/i)
    ).toBeInTheDocument();
    await waitFor(() => {
      expectPendingCount(1);
    });

    fireEvent.click(screen.getAllByRole('button', { name: /sincronizar ahora/i })[0]!);

    expect(
      await screen.findByText(/1 venta\(s\) pendiente\(s\) sincronizada\(s\) correctamente/i)
    ).toBeInTheDocument();
    expectPendingCount(0);
  });

  it('shows sync error per pending sale and allows retrying it', async () => {
    seedSession('ADMIN');
    await addPendingSale(buildPendingSalePayload('99999999-8888-4777-8666-555555555555'));

    mockAuthenticatedPosFetch({
      onCreateSale: async (callNumber) => {
        if (callNumber === 1) {
          return new Response(
            JSON.stringify({
              error: {
                message: 'La caja está cerrada. Abre una nueva sesión antes de registrar más ventas.'
              }
            }),
            { status: 409, headers: { 'content-type': 'application/json' } }
          );
        }

        return new Response(JSON.stringify(buildCreatedSaleResponse(1500)), {
          status: 201,
          headers: { 'content-type': 'application/json' }
        });
      }
    });

    render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>);

    await waitFor(() => {
      expectPendingCount(1);
    });

    fireEvent.click(screen.getAllByRole('button', { name: /sincronizar ahora/i })[0]!);

    expect(
      await screen.findByText(/la caja está cerrada\. abre una nueva sesión antes de registrar más ventas/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sincronizar ahora/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sincronizar ahora/i }));

    expect(
      await screen.findByText(/1 venta\(s\) pendiente\(s\) sincronizada\(s\) correctamente/i)
    ).toBeInTheDocument();
    expectPendingCount(0);
  });
});
