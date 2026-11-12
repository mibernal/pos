import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * La regla es una y no admite matices: **nunca se recarga con una venta empezada.**
 *
 * Una actualización que se lleva por delante el carrito de un cajero cuesta más que el
 * defecto que venía a arreglar, y además no deja rastro: el cajero solo ve que la pantalla
 * parpadeó y la comanda no está.
 */

let avisarDeVersionNueva: (() => void) | undefined;
const aplicarSW = vi.fn(() => Promise.resolve());

vi.mock('virtual:pwa-register', () => ({
  registerSW: (opciones: { onNeedRefresh?: () => void }) => {
    avisarDeVersionNueva = opciones.onNeedRefresh;
    return aplicarSW;
  }
}));

import { useActualizacion } from './useActualizacion';
import { useCartStore } from '../features/sales/hooks/useCartStore';

const productoEnCarrito = [{ productId: 'p1', name: 'Café', quantity: 1, unitPriceCents: 5000 }];

describe('Cuándo se aplica una versión nueva', () => {
  beforeEach(() => {
    aplicarSW.mockClear();
    avisarDeVersionNueva = undefined;
    useCartStore.setState({ cartItems: [] });
  });

  it('con la caja libre se aplica sola, sin preguntar', async () => {
    const { result } = renderHook(() => useActualizacion());

    act(() => avisarDeVersionNueva?.());

    await waitFor(() => expect(aplicarSW).toHaveBeenCalledWith(true));
    // No hay nada que anunciar: cuando el aviso serviría, la recarga ya está en marcha.
    expect(result.current.hayVersionNueva).toBe(false);
  });

  it('con una venta empezada no recarga: avisa y espera', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useCartStore.setState({ cartItems: productoEnCarrito as any });
    const { result } = renderHook(() => useActualizacion());

    act(() => avisarDeVersionNueva?.());

    await waitFor(() => expect(result.current.hayVersionNueva).toBe(true));
    expect(aplicarSW).not.toHaveBeenCalled();
  });

  it('se aplica sola en cuanto se cobra, sin que el cajero haga nada', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useCartStore.setState({ cartItems: productoEnCarrito as any });
    const { result, rerender } = renderHook(() => useActualizacion());

    act(() => avisarDeVersionNueva?.());
    await waitFor(() => expect(result.current.hayVersionNueva).toBe(true));

    // Cobrar vacía el carrito. Ese es el momento en que actualizar no cuesta nada.
    act(() => useCartStore.setState({ cartItems: [] }));
    rerender();

    await waitFor(() => expect(aplicarSW).toHaveBeenCalledWith(true));
  });
});
