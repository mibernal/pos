import { randomUUID } from 'node:crypto';
import type {
  AutoChargeInput,
  AutoChargeResult,
  IPaymentGateway,
  PaymentIntentInput,
  PaymentWebhookResult,
  TokenizePaymentMethodInput,
  TokenizedPaymentMethod
} from './payment-gateway.interface.js';

/**
 * Pasarela de mentira para desarrollo y pruebas.
 *
 * El resultado del cobro se decide por el propio token, no al azar: un token que contenga
 * `DECLINE` se rechaza siempre y uno con `ERROR` falla siempre. Así se puede ensayar la
 * secuencia de cobranza entera —tres reintentos, gracia, degradación y suspensión— con el
 * reloj adelantado y sin depender de la caja de arena de nadie.
 */
export class MockGateway implements IPaymentGateway {
  async createPaymentIntent(input: PaymentIntentInput) {
    const mockTransactionId = `MOCK_${Date.now()}`;
    const checkoutUrl = `/api/v1/billing/mock-checkout?reference=${input.reference}&redirectUrl=${encodeURIComponent(input.redirectUrl)}`;
    
    return { checkoutUrl, gatewayId: mockTransactionId };
  }

  verifyWebhookSignature() {
    return true; // Siempre válido en mock
  }

  async parseWebhook(payload: any): Promise<PaymentWebhookResult> { // eslint-disable-line @typescript-eslint/no-explicit-any
    return {
      reference: payload.reference,
      gatewayTransactionId: payload.gatewayTransactionId || `MOCK_${Date.now()}`,
      status: payload.status || 'APPROVED',
      rawPayload: payload
    };
  }

  async tokenizePaymentMethod(input: TokenizePaymentMethodInput): Promise<TokenizedPaymentMethod> {
    // El token de tarjeta se conserva dentro de la fuente de pago para que la prueba pueda
    // pedir un rechazo escribiéndolo en el token: `tok_DECLINE`. El sufijo aleatorio imita
    // que cada fuente de pago es única —la tabla lo exige con un índice— para que dos
    // comercios puedan registrar «la misma» tarjeta de prueba sin chocar.
    return {
      gatewayToken: `MOCK_SRC_${input.cardToken}_${randomUUID()}`,
      brand: 'VISA',
      lastFour: '4242',
      expMonth: 12,
      expYear: new Date().getFullYear() + 3,
      holderName: 'MOCK CARDHOLDER',
      raw: { mock: true }
    };
  }

  async chargeStoredPaymentMethod(input: AutoChargeInput): Promise<AutoChargeResult> {
    const token = input.paymentMethodToken.toUpperCase();

    if (token.includes('ERROR')) {
      return {
        success: false,
        gatewayTransactionId: '',
        status: 'ERROR',
        declineReason: 'Error simulado de la pasarela',
        rawPayload: { mock: true, idempotencyKey: input.idempotencyKey }
      };
    }

    if (token.includes('DECLINE')) {
      return {
        success: false,
        gatewayTransactionId: `MOCK_TX_${input.idempotencyKey}`,
        status: 'DECLINED',
        declineReason: 'Fondos insuficientes (simulado)',
        rawPayload: { mock: true, idempotencyKey: input.idempotencyKey }
      };
    }

    if (token.includes('PENDING')) {
      return {
        success: false,
        gatewayTransactionId: `MOCK_TX_${input.idempotencyKey}`,
        status: 'PENDING',
        rawPayload: { mock: true, idempotencyKey: input.idempotencyKey }
      };
    }

    return {
      success: true,
      gatewayTransactionId: `MOCK_TX_${input.idempotencyKey}`,
      status: 'APPROVED',
      rawPayload: { mock: true, idempotencyKey: input.idempotencyKey, amountCents: input.amountCents }
    };
  }
}
