import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from './helpers/render-with-providers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PosScreen } from '../src/features/sales';
import { formatMoneyFromCents } from '../src/lib/format';
import type { PosApiClient } from '../src/types';

function normalizeText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function buildApiMock(products: Array<{ id: string; name: string; barcode: string | null; price_cents: number }>) {
  const apiMock = {
    listProducts: vi.fn().mockResolvedValue({
      items: products.map((product) => ({
        id: product.id,
        tenantId: 'tenant-1',
        branchId: 'branch-1',
        name: product.name,
        category: 'Bebidas',
        taxCategory: 'IVA_19',
        barcode: product.barcode,
        price_cents: product.price_cents,
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })),
      page: {
        limit: 120,
        count: products.length,
        hasMore: false
      }
    }),
    listCustomers: vi.fn().mockResolvedValue([]),
    createSale: vi.fn(),
    getSale: vi.fn(),
    getCurrentCashSession: vi.fn(),
    getCurrentTenantProfile: vi.fn(),
    listBranches: vi.fn(),
    listSales: vi.fn(),
    login: vi.fn(),
    me: vi.fn(),
    openCashSession: vi.fn(),
    patchProduct: vi.fn(),
    createProduct: vi.fn(),
    toggleProductActive: vi.fn(),
    updateTenantBusinessProfile: vi.fn(),
    updateTenantTaxProfile: vi.fn(),
    voidSale: vi.fn()
  };

  return apiMock as typeof apiMock & PosApiClient;
}

function buildCreatedSaleResponse(totalCents: number) {
  return {
    sale: {
      id: 'sale-1',
      tenant_id: 'tenant-1',
      branch_id: 'branch-1',
      cash_session_id: 'cash-session-1',
      sale_number: 23,
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
      created_by_user_id: 'user-1',
      void_reason: null,
      voided_by_user_id: null,
      voided_at: null,
      created_at: new Date().toISOString()
    },
    items: [
      {
        id: 'sale-item-1',
        product_id: 'product-1',
        qty: 1,
        price_cents: totalCents,
        line_total_cents: totalCents
      }
    ]
  };
}

function expectMoneyVisible(cents: number) {
  expect(
    screen.getAllByText(
      (content) => normalizeText(content) === normalizeText(formatMoneyFromCents(cents))
    ).length
  ).toBeGreaterThan(0);
}

describe('PosScreen', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds the highlighted product with Enter and removes selected item with Delete', async () => {
    const api = buildApiMock([
      {
        id: 'product-1',
        name: 'Cafe Americano',
        barcode: '77010001',
        price_cents: 1500
      }
    ]);

    renderWithProviders(
      <PosScreen
        branchId="branch-1"
        cashSessionId="cash-session-1"
        branchName="Sucursal Centro"
        ticketTemplate={{
          businessName: 'POS DIAN',
          nit: '900123123',
          address: 'Calle 1',
          phone: '',
          footerMessage: '',
          logoUrl: '',
          printerWidth: '80mm'
        }}
        tenantTaxMode="IVA"
        onSaleQueued={vi.fn()}
      />,
      { api }
    );

    expect(await screen.findByRole('button', { name: /Cafe Americano/i })).toBeInTheDocument();

    const searchInput = screen.getByLabelText('Búsqueda rápida');
    searchInput.focus();
    fireEvent.keyDown(searchInput, { key: 'Enter' });

    expect(await screen.findByText('Orden Actual')).toBeInTheDocument();
    expect(screen.getByLabelText('Cantidad')).toBeInTheDocument();
    expectMoneyVisible(1500);

    fireEvent.keyDown(window, { key: 'Delete' });

    await waitFor(() => {
      expect(
        screen.getByText(/el carrito está vacío/i)
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cobrar/i })).toBeDisabled();
    });
  });

  it('opens the checkout modal, calculates cash change and submits a compatible sale payload', async () => {
    const api = buildApiMock([
      {
        id: 'product-1',
        name: 'Cafe Americano',
        barcode: '77010001',
        price_cents: 1500
      }
    ]);
    api.createSale.mockResolvedValue(buildCreatedSaleResponse(1500));

    const randomValues = [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    ];
    let randomIndex = 0;

    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => {
      const nextValue = randomValues[randomIndex] ?? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      randomIndex += 1;
      return nextValue as `${string}-${string}-${string}-${string}-${string}`;
    });

    renderWithProviders(
      <PosScreen
        branchId="branch-1"
        cashSessionId="cash-session-1"
        branchName="Sucursal Centro"
        ticketTemplate={{
          businessName: 'POS DIAN',
          nit: '900123123',
          address: 'Calle 1',
          phone: '',
          footerMessage: '',
          logoUrl: '',
          printerWidth: '80mm'
        }}
        tenantTaxMode="IVA"
        onSaleQueued={vi.fn()}
      />,
      { api }
    );

    expect(await screen.findByRole('button', { name: /Cafe Americano/i })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText('Búsqueda rápida'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /cobrar/i }));

    const dialog = screen.getByRole('dialog', { name: 'Cobrar venta' });
    const receivedInput = within(dialog).getByLabelText('Recibido (COP)');

    fireEvent.change(receivedInput, { target: { value: '20' } });

    await waitFor(() => {
      const changeCard = within(dialog).getByText('Cambio').closest('.metric-card');
      expect(normalizeText(changeCard?.textContent)).toContain(
        normalizeText(formatMoneyFromCents(500))
      );
    });

    fireEvent.click(within(dialog).getByRole('button', { name: /confirmar cobro/i }));

    await waitFor(() => {
      expect(api.createSale).toHaveBeenCalledTimes(1);
    });

    expect(api.createSale).toHaveBeenCalledWith(
      expect.objectContaining({
        client_uuid: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        branch_id: 'branch-1',
        cash_session_id: 'cash-session-1',
        discount_cents: 0,
        items: [
          {
            product_id: 'product-1',
            qty: 1,
            price_cents: 1500
          }
        ],
        /**
         * Lo aplicado a la venta son 1.500 y lo entregado 2.000: el vuelto es la resta.
         * Antes el frontend descontaba el cambio y tiraba lo entregado, así que el arqueo
         * no podía distinguir el pago justo del pago con vuelto.
         */
        payments: [{ method: 'CASH', amount_cents: 1500, tendered_cents: 2000 }]
      })
    );

    expect(await screen.findByText(/venta #23 registrada/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /imprimir html/i })).toBeInTheDocument();
    expect(screen.getByText(/estado dian/i)).toBeInTheDocument();
    expect(
      screen.getByText(/el carrito está vacío/i)
    ).toBeInTheDocument();
  });

  it('solo permite cobrar el pago mixto cuando las líneas cuadran y los vouchers están completos', async () => {
    const api = buildApiMock([
      {
        id: 'product-1',
        name: 'Cafe Americano',
        barcode: '77010001',
        price_cents: 1500
      }
    ]);

    renderWithProviders(
      <PosScreen
        branchId="branch-1"
        cashSessionId="cash-session-1"
        branchName="Sucursal Centro"
        ticketTemplate={{
          businessName: 'POS DIAN',
          nit: '900123123',
          address: 'Calle 1',
          phone: '',
          footerMessage: '',
          logoUrl: '',
          printerWidth: '80mm'
        }}
        tenantTaxMode="IVA"
        onSaleQueued={vi.fn()}
      />,
      { api }
    );

    expect(await screen.findByRole('button', { name: /Cafe Americano/i })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText('Búsqueda rápida'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /cobrar/i }));

    const dialog = screen.getByRole('dialog', { name: 'Cobrar venta' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Mixto/i }));

    const confirmButton = within(dialog).getByRole('button', { name: /confirmar cobro/i });

    // El panel mixto reparte el total en dos líneas de efectivo, así que arranca cuadrado.
    expect(confirmButton).toBeEnabled();

    // Si las líneas dejan de sumar el total, no se puede cobrar.
    fireEvent.change(within(dialog).getByLabelText('Monto línea 1'), { target: { value: '1' } });
    await waitFor(() => {
      expect(confirmButton).toBeDisabled();
    });

    // Al volver a cuadrar la suma, se habilita.
    fireEvent.change(within(dialog).getByLabelText('Monto línea 2'), { target: { value: '14' } });
    await waitFor(() => {
      expect(confirmButton).toBeEnabled();
    });

    // Una línea con tarjeta exige voucher: sin él vuelve a bloquearse.
    fireEvent.change(within(dialog).getByLabelText('Método línea 2'), { target: { value: 'CARD' } });
    await waitFor(() => {
      expect(confirmButton).toBeDisabled();
    });

    fireEvent.change(within(dialog).getByLabelText('Voucher línea 2'), { target: { value: '12345' } });
    await waitFor(() => {
      expect(confirmButton).toBeEnabled();
    });
  });
});
