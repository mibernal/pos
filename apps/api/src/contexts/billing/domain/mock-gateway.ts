import type { IPaymentGateway, PaymentIntentInput, PaymentWebhookResult } from './payment-gateway.interface.js';

export class MockGateway implements IPaymentGateway {
  async createPaymentIntent(input: PaymentIntentInput) {
    const mockTransactionId = `MOCK_${Date.now()}`;
    const checkoutUrl = `/api/v1/billing/mock-checkout?reference=${input.reference}&redirectUrl=${encodeURIComponent(input.redirectUrl)}`;
    
    return { checkoutUrl, gatewayId: mockTransactionId };
  }

  verifyWebhookSignature() {
    return true; // Siempre válido en mock
  }

  parseWebhook(payload: any): PaymentWebhookResult { // eslint-disable-line @typescript-eslint/no-explicit-any
    return {
      reference: payload.reference,
      gatewayTransactionId: payload.gatewayTransactionId || `MOCK_${Date.now()}`,
      status: payload.status || 'APPROVED',
      rawPayload: payload
    };
  }
}
