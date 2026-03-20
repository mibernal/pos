import { describe, expect, it } from 'vitest';
import { ApiClientError } from '../src/lib/api';
import { getCheckoutErrorMessage } from '../src/features/sales';

describe('sales checkout error mapping', () => {
  it('maps 401 responses to a session-expired message', () => {
    expect(getCheckoutErrorMessage(new ApiClientError('No autorizado', { status: 401 }))).toMatch(
      /tu sesión expiró/i
    );
  });

  it('maps closed cash session responses to a cashier-friendly message', () => {
    expect(
      getCheckoutErrorMessage(
        new ApiClientError('La sesión de caja ya fue cerrada', { status: 409 })
      )
    ).toMatch(/caja está cerrada/i);
  });

  it('keeps backend validation messages when they are already useful', () => {
    expect(
      getCheckoutErrorMessage(
        new ApiClientError('La suma de payments debe ser igual al total de la venta', {
          status: 400
        })
      )
    ).toBe('La suma de payments debe ser igual al total de la venta');
  });
});
