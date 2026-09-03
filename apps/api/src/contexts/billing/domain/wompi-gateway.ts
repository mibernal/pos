import { createHash } from 'node:crypto';
import { env } from '../../../app/env.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import type {
  AutoChargeInput,
  AutoChargeResult,
  IPaymentGateway,
  PaymentIntentInput,
  PaymentWebhookResult,
  TokenizePaymentMethodInput,
  TokenizedPaymentMethod
} from './payment-gateway.interface.js';

/** Ninguna llamada a la pasarela puede quedarse colgada: el motor procesa en serie. */
const REQUEST_TIMEOUT_MS = 20_000;

export class WompiGateway implements IPaymentGateway {
  private readonly publicKey = env.WOMPI_PUBLIC_KEY || 'pub_test_XXXX';
  private readonly eventsKey = env.WOMPI_EVENTS_KEY || 'events_test_XXXX';
  private readonly privateKey = env.WOMPI_PRIVATE_KEY;
  private readonly apiUrl = env.WOMPI_API_URL.replace(/\/$/, '');

  async createPaymentIntent(input: PaymentIntentInput): Promise<{ checkoutUrl: string }> {
    // Wompi usa Widget Drop-in o Web Checkout. Para Web Checkout generamos una URL con parámetros.
    // Usualmente se hace redirigiendo al checkout público de Wompi.
    
    // Convertir centavos (e.g. 4990000) a lo que requiere Wompi (el valor en Wompi es en centavos por defecto)
    const amountInCents = input.amountCents;
    const currency = input.currency || 'COP';

    // Para integración real de Web Checkout de Wompi
    const checkoutUrl = new URL('https://checkout.wompi.co/p/');
    checkoutUrl.searchParams.append('public-key', this.publicKey);
    checkoutUrl.searchParams.append('currency', currency);
    checkoutUrl.searchParams.append('amount-in-cents', amountInCents.toString());
    checkoutUrl.searchParams.append('reference', input.reference);
    checkoutUrl.searchParams.append('customer-data:email', input.customerEmail);
    checkoutUrl.searchParams.append('redirect-url', input.redirectUrl);

    return { checkoutUrl: checkoutUrl.toString() };
  }

  verifyWebhookSignature(headers: Record<string, string>, rawBody: string): boolean {
    // Wompi valida el evento combinando properties, eventsKey y un hash SHA256
    // La documentación de Wompi pide concatenar los valores de properties + timestamp + secret de eventos
    try {
      const payload = JSON.parse(rawBody);
      const signature = payload.signature;
      if (!signature) return false;

      const properties = signature.properties; // array of property names
      const checksum = signature.checksum;

      let concatenatedValues = '';
      for (const prop of properties) {
        // prop ej: 'transaction.id'
        const parts = prop.split('.');
        let val: any = payload.data; // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const p of parts) {
          val = val?.[p];
        }
        concatenatedValues += (val ?? '');
      }
      
      concatenatedValues += payload.timestamp;
      concatenatedValues += this.eventsKey;

      const hash = createHash('sha256').update(concatenatedValues).digest('hex');
      return hash === checksum;
    } catch {
      return false;
    }
  }

  async parseWebhook(payload: any): Promise<PaymentWebhookResult> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const transaction = payload?.data?.transaction;
    
    let status: 'APPROVED' | 'DECLINED' | 'ERROR' = 'ERROR';
    if (transaction?.status === 'APPROVED') {
      status = 'APPROVED';
    } else if (transaction?.status === 'DECLINED' || transaction?.status === 'VOIDED') {
      status = 'DECLINED';
    }

    return {
      reference: transaction?.reference || '',
      gatewayTransactionId: transaction?.id || '',
      status,
      // Wompi entrega el importe ya en centavos.
      amountCents: typeof transaction?.amount_in_cents === 'number' ? transaction.amount_in_cents : undefined,
      currency: transaction?.currency,
      // Wompi no envía un id de evento propio: el par transacción + estado identifica el
      // hecho, y es lo que hace idempotente un reintento de la pasarela.
      eventId: transaction?.id ? `${transaction.id}:${transaction.status}` : undefined,
      rawPayload: payload
    };
  }

  /* ---------------------------------------------------------------- *
   * Cobro recurrente
   * ---------------------------------------------------------------- */

  /**
   * Guarda la tarjeta como *fuente de pago* de Wompi.
   *
   * El número de la tarjeta nunca pasa por aquí: el navegador lo cambia por un token de un
   * solo uso contra `/tokens/cards` usando la llave pública, y lo que llega a este método
   * es ese token más la aceptación de los términos que Wompi exige para poder cobrar sin
   * el tarjetahabiente delante. Lo que devuelve —el `payment_source_id`— solo sirve para
   * cobrar desde nuestra cuenta.
   */
  async tokenizePaymentMethod(input: TokenizePaymentMethodInput): Promise<TokenizedPaymentMethod> {
    const body = await this.request('/payment_sources', {
      type: 'CARD',
      token: input.cardToken,
      customer_email: input.customerEmail,
      acceptance_token: input.acceptanceToken
    });

    const data = body?.data;
    if (!data?.id) {
      throw new AppError(502, 'GATEWAY_ERROR', 'Wompi no devolvió una fuente de pago válida');
    }

    const card = data.public_data ?? {};

    return {
      gatewayToken: String(data.id),
      brand: card.brand ?? card.type ?? null,
      lastFour: card.last_four ?? null,
      expMonth: card.exp_month ? Number(card.exp_month) : null,
      expYear: card.exp_year ? Number(card.exp_year) : null,
      holderName: card.card_holder ?? null,
      raw: data
    };
  }

  /**
   * Cobra sobre una fuente de pago guardada.
   *
   * Wompi responde `PENDING` con frecuencia: la transacción se crea y el resultado llega
   * después por webhook. Eso **no** es un fallo y no debe disparar la cobranza —de ahí que
   * `AutoChargeResult` distinga `PENDING` de `DECLINED`, y que quien llama espere al
   * webhook en lugar de dar el cobro por perdido.
   */
  async chargeStoredPaymentMethod(input: AutoChargeInput): Promise<AutoChargeResult> {
    const body = await this.request(
      '/transactions',
      {
        amount_in_cents: input.amountCents,
        currency: input.currency,
        customer_email: input.customerEmail,
        payment_source_id: Number(input.paymentMethodToken),
        reference: input.reference ?? input.idempotencyKey,
        recurrent: true
      },
      // Wompi deduplica por esta cabecera: si la respuesta se pierde y reintentamos, nos
      // devuelve la transacción original en lugar de cobrar dos veces.
      { 'Idempotency-Key': input.idempotencyKey }
    );

    const data = body?.data;
    const status = String(data?.status ?? 'ERROR').toUpperCase();

    const normalized: AutoChargeResult['status'] =
      status === 'APPROVED' ? 'APPROVED'
      : status === 'PENDING' ? 'PENDING'
      : status === 'DECLINED' || status === 'VOIDED' ? 'DECLINED'
      : 'ERROR';

    return {
      success: normalized === 'APPROVED',
      gatewayTransactionId: data?.id ? String(data.id) : '',
      status: normalized,
      declineReason: data?.status_message ?? undefined,
      rawPayload: body
    };
  }

  /**
   * Toda llamada autenticada a Wompi pasa por aquí, con la llave privada y un tiempo
   * máximo. La llave privada no sale nunca al frontend: es la que autoriza a mover dinero.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async request(path: string, payload: unknown, extraHeaders: Record<string, string> = {}): Promise<any> {
    if (!this.privateKey) {
      throw new AppError(
        503,
        'GATEWAY_NOT_CONFIGURED',
        'El cobro recurrente con Wompi no está configurado: falta WOMPI_PRIVATE_KEY'
      );
    }

    const response = await fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.privateKey}`,
        ...extraHeaders
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    const text = await response.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { unparsable_body: text.slice(0, 1000) };
    }

    if (!response.ok) {
      const message = body?.error?.reason ?? body?.error?.type ?? `Wompi respondió ${response.status}`;
      throw new AppError(502, 'GATEWAY_ERROR', `Wompi: ${message}`, { status: response.status, body });
    }

    return body;
  }
}
