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
   * Convierte un token de tarjeta de un solo uso en una fuente de pago reutilizable.
   *
   * Opcional porque no todas las pasarelas lo ofrecen: en Colombia lo hace Wompi, y por eso
   * es la pasarela con la que se cobra solo. Las demás quedan como pago manual —el comercio
   * pasa por el checkout cada mes— que es peor experiencia pero no una integración a medias.
   */
  tokenizePaymentMethod?(input: TokenizePaymentMethodInput): Promise<TokenizedPaymentMethod>;

  /**
   * Cobro automático server-to-server sobre una fuente de pago ya guardada.
   */
  chargeStoredPaymentMethod?(input: AutoChargeInput): Promise<AutoChargeResult>;
}

export interface TokenizePaymentMethodInput {
  /** Token de un solo uso que genera el navegador con la llave pública. */
  cardToken: string;
  /** Aceptación de los términos del comercio, que la pasarela exige para el cobro diferido. */
  acceptanceToken: string;
  customerEmail: string;
}

export interface TokenizedPaymentMethod {
  gatewayToken: string;
  brand?: string | null;
  lastFour?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
  holderName?: string | null;
  raw?: unknown;
}

export interface AutoChargeInput {
  paymentMethodToken: string;
  amountCents: number;
  currency: string;
  /**
   * Llave de idempotencia derivada de la factura y el intento.
   *
   * Es lo que impide cobrar dos veces cuando la respuesta de la pasarela se pierde: el
   * reintento llega con la misma llave y la pasarela devuelve la transacción original en
   * lugar de crear una nueva.
   */
  idempotencyKey: string;
  description: string;
  customerEmail?: string;
  /** Referencia propia, para poder casar el webhook posterior con la factura. */
  reference?: string;
}

export interface AutoChargeResult {
  success: boolean;
  gatewayTransactionId: string;
  status: 'APPROVED' | 'PENDING' | 'DECLINED' | 'ERROR';
  /** Motivo del rechazo tal y como lo da la pasarela, para poder decírselo al comercio. */
  declineReason?: string;
  rawPayload: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
