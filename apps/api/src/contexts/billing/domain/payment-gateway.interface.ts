export interface PaymentIntentInput {
  amountCents: number;
  reference: string;
  customerEmail: string;
  redirectUrl: string;
  currency?: string;
  billingCycle: 'MONTHLY' | 'YEARLY';
}

export interface PaymentWebhookResult {
  reference: string;
  gatewayTransactionId: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'ERROR';
  rawPayload: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface IPaymentGateway {
  /**
   * Inicializa la intención de pago o devuelve la URL de redirección al checkout
   */
  createPaymentIntent(input: PaymentIntentInput): Promise<{ checkoutUrl: string; token?: string; gatewayId?: string }>;
  
  /**
   * Valida que el webhook recibido sea genuino utilizando las llaves criptográficas
   */
  verifyWebhookSignature(headers: Record<string, string>, rawBody: string): boolean;
  
  /**
   * Parsea el payload del webhook y lo estandariza
   */
  parseWebhook(payload: any): Promise<PaymentWebhookResult>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
