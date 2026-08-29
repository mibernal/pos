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
  /**
   * Importe que la pasarela dice haber cobrado, en centavos.
   *
   * Se compara contra el importe registrado al crear el checkout antes de conceder nada.
   * La firma del webhook prueba que el mensaje viene de la pasarela; no prueba que el
   * importe sea el que corresponde al plan que se va a activar.
   */
  amountCents?: number;
  currency?: string;
  /** Identificador del evento en la pasarela, cuando lo hay, para deduplicar reintentos. */
  eventId?: string;
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

  /**
   * Cobro automático server-to-server (opcional si el gateway lo soporta)
   */
  chargeStoredPaymentMethod?(input: AutoChargeInput): Promise<AutoChargeResult>;
}

export interface AutoChargeInput {
  paymentMethodToken: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  description: string;
}

export interface AutoChargeResult {
  success: boolean;
  gatewayTransactionId: string;
  status: 'APPROVED' | 'DECLINED' | 'ERROR';
  rawPayload: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
