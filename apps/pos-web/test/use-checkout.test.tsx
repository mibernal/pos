import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiProvider } from '../src/features/auth';
import { useCheckout } from '../src/features/sales/hooks/useCheckout';
import { ApiClientError } from '../src/lib/api';
import { clearPendingSales, listPendingSales } from '../src/lib/offline-queue';
import type { CartItem } from '../src/types';

/**
 * El camino del dinero, sin montar la pantalla.
 *
 * `useCheckout` es donde se arma la venta y se decide qué hacer cuando el cobro falla, y
 * hasta ahora solo se ejercía montando el POS entero: novecientas líneas de pantalla para
 * comprobar aritmética. Aquí se prueba en milisegundos, que es lo que hace que se pruebe.
 */

const ARTICULOS: CartItem[] = [
  {
    productId: '11111111-1111-4111-8111-111111111111',
    name: 'Café',
    qty: 2,
    priceCents: 5_000,
    category: 'Bebidas',
    barcode: null
  } as unknown as CartItem
];

function conApi(api: unknown) {
  return ({ children }: { children: ReactNode }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createElement(ApiProvider as any, { client: api }, children);
}

describe('useCheckout', () => {
  beforeEach(async () => {
    await clearPendingSales();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function montar(api: unknown, onSaleQueued = vi.fn(), onSaleSuccess = vi.fn()) {
    const { result } = renderHook(
      () => useCheckout({ branchId: 'sucursal-1', cashSessionId: 'caja-1', onSaleSuccess, onSaleQueued }),
      { wrapper: conApi(api) }
    );
    return { result, onSaleQueued, onSaleSuccess };
  }

  it('la propina va dentro del total del snapshot', async () => {
    const createSale = vi.fn().mockResolvedValue({ sale: { sale_number: 7, dian_status: 'PENDING' } });
    const { result, onSaleSuccess } = montar({ createSale });

    await act(async () => {
      await result.current.processSale(ARTICULOS, 1_000, 2_000, 10_000, 9_000, [{ method: 'CASH', amount_cents: 11_000 }], null);
    });

    const enviado = createSale.mock.calls[0]![0];

    /**
     * El servidor calcula `subtotal - descuento + propina` y compara contra este snapshot:
     * si el frontend no sumara la propina aquí, toda venta con propina se rechazaría por
     * discrepancia de importes. Es el tipo de aritmética que no se puede comprobar mirando.
     */
    expect(enviado.snapshot.total_cents).toBe(11_000);
    expect(enviado.snapshot.subtotal_cents).toBe(10_000);
    expect(enviado.snapshot.discount_cents).toBe(1_000);
    expect(enviado.snapshot.tip_cents).toBe(2_000);
    expect(onSaleSuccess).toHaveBeenCalledOnce();
  });

  it('sin conexión la venta se guarda en la cola, no se pierde', async () => {
    const createSale = vi.fn().mockRejectedValue(new ApiClientError('sin red', { isNetworkError: true }));
    const { result, onSaleQueued, onSaleSuccess } = montar({ createSale });

    await act(async () => {
      await result.current.processSale(ARTICULOS, 0, 0, 10_000, 10_000, [{ method: 'CASH', amount_cents: 10_000 }], null);
    });

    const pendientes = await listPendingSales();
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]!.payload.branch_id).toBe('sucursal-1');

    expect(result.current.saleMessage).toMatch(/pendiente por falta de conexión/i);
    expect(result.current.saleError).toBeNull();

    // El orden importa: primero se avisa de la cola y luego se limpia el carrito, o la
    // pantalla contaría una venta pendiente que todavía no está escrita.
    expect(onSaleQueued).toHaveBeenCalledOnce();
    expect(onSaleSuccess).toHaveBeenCalledOnce();
  });

  it('un 500 del servidor también encola: la caja no se detiene', async () => {
    const createSale = vi.fn().mockRejectedValue(new ApiClientError('boom', { status: 500 }));
    const { result } = montar({ createSale });

    await act(async () => {
      await result.current.processSale(ARTICULOS, 0, 0, 10_000, 10_000, [{ method: 'CASH', amount_cents: 10_000 }], null);
    });

    expect(await listPendingSales()).toHaveLength(1);
  });

  it('un rechazo del negocio no se encola: se le dice al cajero qué pasó', async () => {
    const createSale = vi.fn().mockRejectedValue(
      new ApiClientError('La sesión de caja está cerrada', { status: 409 })
    );
    const { result, onSaleSuccess } = montar({ createSale });

    await act(async () => {
      await result.current.processSale(ARTICULOS, 0, 0, 10_000, 10_000, [{ method: 'CASH', amount_cents: 10_000 }], null);
    });

    // Encolar un 409 sería guardar para reintentar algo que va a fallar igual cada vez.
    expect(await listPendingSales()).toHaveLength(0);
    expect(result.current.saleError).toMatch(/caja está cerrada/i);
    expect(onSaleSuccess).not.toHaveBeenCalled();
  });

  it('la venta cobrada deja el ticket listo para imprimir', async () => {
    const createSale = vi.fn().mockResolvedValue({ sale: { sale_number: 12, dian_status: 'ACCEPTED' } });
    const { result } = montar({ createSale });

    await act(async () => {
      await result.current.processSale(ARTICULOS, 0, 0, 10_000, 10_000, [{ method: 'CASH', amount_cents: 10_000 }], null);
    });

    await waitFor(() => expect(result.current.lastPrintedSaleSnapshot).not.toBeNull());
    expect(result.current.lastPrintedSaleSnapshot!.items).toEqual([
      { name: 'Café', qty: 2, priceCents: 5_000, lineTotalCents: 10_000, notes: undefined }
    ]);
    expect(result.current.saleMessage).toContain('#12');
  });

  it('la mesa viaja con la venta cuando se cobra una cuenta abierta', async () => {
    const createSale = vi.fn().mockResolvedValue({ sale: { sale_number: 1, dian_status: 'PENDING' } });
    const { result } = montar({ createSale });

    await act(async () => {
      await result.current.processSale(
        ARTICULOS, 0, 0, 10_000, 10_000, [{ method: 'CASH', amount_cents: 10_000 }], null, 'cuenta-de-mesa-1'
      );
    });

    expect(createSale.mock.calls[0]![0].table_order_id).toBe('cuenta-de-mesa-1');
  });
});
