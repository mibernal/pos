import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SessionProvider } from '../src/features/auth';
import { HistoryScreen } from '../src/features/history';
import { writeAuthSession } from '../src/lib/session';
import type { PosApiClient } from '../src/types';

function seedSession(role: 'ADMIN' | 'CASHIER' = 'ADMIN') {
  writeAuthSession({
    accessToken: 'token-admin',
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: '22222222-2222-4222-8222-222222222222',
      taxMode: 'IVA',
      role,
      email: 'admin@demo.posdian.local',
      name: 'Admin Demo',
      active: true
    }
  });
}

function mockSessionFetch(role: 'ADMIN' | 'CASHIER' = 'ADMIN') {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);

    if (url.endsWith('/auth/me')) {
      return new Response(
        JSON.stringify({
          user: {
            id: '11111111-1111-4111-8111-111111111111',
            tenantId: '22222222-2222-4222-8222-222222222222',
            taxMode: 'IVA',
            role,
            email: 'admin@demo.posdian.local',
            name: 'Admin Demo',
            active: true
          }
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

function buildApiMock() {
  const saleState: {
    sale: {
      id: string;
      tenant_id: string;
      branch_id: string;
      cash_session_id: string;
      sale_number: number;
      status: 'COMPLETED' | 'VOID';
      subtotal_cents: number;
      discount_cents: number;
      total_cents: number;
      tax_total_cents: number;
      tax_lines_json: [];
      payment_json: {
        mode: 'MIXED';
        total_cents: number;
        amounts: {
          cash_cents: number;
          card_cents: number;
          transfer_cents: number;
        };
        payments: Array<{ method: 'CASH' | 'CARD'; amount_cents: number }>;
      };
      dian_status: 'SENT';
      created_by_user_id: string;
      void_reason: string | null;
      voided_by_user_id: string | null;
      voided_at: string | null;
      created_at: string;
    };
    dian_document: {
      id: string;
      provider: string;
      status: 'SENT';
      cude: string;
      created_at: string;
      updated_at: string;
    };
  } = {
    sale: {
      id: 'sale-1',
      tenant_id: 'tenant-1',
      branch_id: 'branch-1',
      cash_session_id: 'cash-session-1',
      sale_number: 42,
      status: 'COMPLETED',
      subtotal_cents: 2000,
      discount_cents: 100,
      total_cents: 1900,
      tax_total_cents: 190,
      tax_lines_json: [],
      payment_json: {
        mode: 'MIXED' as const,
        total_cents: 1900,
        amounts: {
          cash_cents: 900,
          card_cents: 1000,
          transfer_cents: 0
        },
        payments: [
          { method: 'CASH' as const, amount_cents: 900 },
          { method: 'CARD' as const, amount_cents: 1000 }
        ]
      },
      dian_status: 'SENT',
      created_by_user_id: 'user-1',
      void_reason: null,
      voided_by_user_id: null,
      voided_at: null,
      created_at: '2026-03-06T15:30:00.000Z'
    },
    dian_document: {
      id: 'dian-1',
      provider: 'mock',
      status: 'SENT',
      cude: 'CUDE-123456789',
      created_at: '2026-03-06T15:30:00.000Z',
      updated_at: '2026-03-06T15:31:00.000Z'
    }
  };

  const apiMock = {
    listSales: vi.fn().mockImplementation(async () => ({
      items: [saleState.sale],
      page: {
        limit: 50,
        count: 1,
        hasMore: false
      }
    })),
    getSale: vi.fn().mockImplementation(async () => ({
      sale: saleState.sale,
      items: [
        {
          id: 'sale-item-1',
          product_id: 'product-1',
          product_name: 'Combo ejecutivo',
          qty: 1,
          price_cents: 1900,
          line_total_cents: 1900
        }
      ],
      dian_document: saleState.dian_document
    })),
    createSale: vi.fn(),
    getCurrentCashSession: vi.fn(),
    getCurrentTenantProfile: vi.fn(),
    listBranches: vi.fn(),
    listProducts: vi.fn(),
    login: vi.fn(),
    me: vi.fn(),
    openCashSession: vi.fn(),
    patchProduct: vi.fn(),
    createProduct: vi.fn(),
    toggleProductActive: vi.fn(),
    updateTenantBusinessProfile: vi.fn(),
    updateTenantTaxProfile: vi.fn(),
    voidSale: vi.fn().mockImplementation(async (_saleId: string, payload: { void_reason: string }) => {
      saleState.sale = {
        ...saleState.sale,
        status: 'VOID',
        void_reason: payload.void_reason,
        voided_by_user_id: 'admin-1',
        voided_at: '2026-03-06T16:00:00.000Z'
      };

      return {
        sale: saleState.sale
      };
    })
  };

  return apiMock as typeof apiMock & PosApiClient;
}

describe('HistoryScreen', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('lists recent sales, loads detail and reprints the ticket', async () => {
    seedSession('ADMIN');
    mockSessionFetch('ADMIN');

    const api = buildApiMock();
    const writeSpy = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({
      document: {
        write: writeSpy,
        close: vi.fn()
      }
    } as unknown as Window);

    render(
      <SessionProvider>
        <HistoryScreen
          api={api}
          branchId="branch-1"
          branchName="Sucursal Centro"
          branchAddress="Calle 1 # 2-3"
          ticketTemplate={{
            businessName: 'POS DIAN',
            nit: '900123123',
            address: 'Calle 1',
            phone: '',
            footerMessage: '',
            logoUrl: ''
          }}
          tenantTaxMode="IVA"
        />
      </SessionProvider>
    );

    expect((await screen.findAllByText('Venta #42')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mixto').length).toBeGreaterThan(0);

    expect(await screen.findByText('Combo ejecutivo')).toBeInTheDocument();
    expect(screen.getByText('CUDE-123456789')).toBeInTheDocument();
    expect(screen.getByText('Impuestos')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ticket/i }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledOnce();
    });
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Incluye IVA'));
  });

  it('requires a reason to void the sale, refreshes the state and reflects VOID in the ticket', async () => {
    seedSession('ADMIN');
    mockSessionFetch('ADMIN');

    const api = buildApiMock();
    const writeSpy = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({
      document: {
        write: writeSpy,
        close: vi.fn()
      }
    } as unknown as Window);

    render(
      <SessionProvider>
        <HistoryScreen
          api={api}
          branchId="branch-1"
          branchName="Sucursal Centro"
          branchAddress="Calle 1 # 2-3"
          ticketTemplate={{
            businessName: 'POS DIAN',
            nit: '900123123',
            address: 'Calle 1',
            phone: '',
            footerMessage: '',
            logoUrl: ''
          }}
          tenantTaxMode="IVA"
        />
      </SessionProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: /anular/i }));

    const dialog = await screen.findByRole('dialog', { name: 'Anular venta' });
    const confirmButton = within(dialog).getByRole('button', { name: /confirmar anulación/i });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Motivo obligatorio'), {
      target: { value: 'Cliente canceló el pedido' }
    });

    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(api.voidSale).toHaveBeenCalledWith('sale-1', {
        void_reason: 'Cliente canceló el pedido'
      });
    });

    expect(await screen.findAllByText(/anulada/i)).not.toHaveLength(0);
    expect(screen.getAllByText(/cliente canceló el pedido/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /ticket/i }));

    await waitFor(() => {
      expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('VENTA ANULADA'));
    });
  });

  it('hides the void action for cashier users', async () => {
    seedSession('CASHIER');
    mockSessionFetch('CASHIER');

    const api = buildApiMock();

    render(
      <SessionProvider>
        <HistoryScreen
          api={api}
          branchId="branch-1"
          branchName="Sucursal Centro"
          branchAddress="Calle 1 # 2-3"
          ticketTemplate={{
            businessName: 'POS DIAN',
            nit: '900123123',
            address: 'Calle 1',
            phone: '',
            footerMessage: '',
            logoUrl: ''
          }}
          tenantTaxMode="IVA"
        />
      </SessionProvider>
    );

    await screen.findByText('Combo ejecutivo');
    expect(screen.queryByRole('button', { name: /anular/i })).not.toBeInTheDocument();
  });
});
