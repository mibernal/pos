import { env } from '../../../app/env.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { WompiGateway } from './wompi-gateway.js';
import { MockGateway } from './mock-gateway.js';
import type { IPaymentGateway } from './payment-gateway.interface.js';

/**
 * Pasarelas capaces de cobrar solas, es decir, de guardar un medio de pago reutilizable.
 *
 * MercadoPago y Stripe siguen sirviendo para el pago manual por checkout; simplemente no
 * entran aquí. Prometer cobro automático sobre una pasarela que no lo soporta sería peor
 * que no ofrecerlo: el comercio deja de vigilar su factura y la suscripción se le cae.
 */
export type RecurringGatewayName = 'WOMPI' | 'MOCK';

export function isRecurringGateway(name: string): name is RecurringGatewayName {
  return name === 'WOMPI' || name === 'MOCK';
}

export function recurringGateway(name: RecurringGatewayName = env.BILLING_RECURRING_GATEWAY): IPaymentGateway {
  const adapter = name === 'MOCK' ? new MockGateway() : new WompiGateway();

  if (!adapter.chargeStoredPaymentMethod || !adapter.tokenizePaymentMethod) {
    throw new AppError(503, 'GATEWAY_NOT_RECURRING', `La pasarela ${name} no soporta cobro recurrente`);
  }

  return adapter;
}
