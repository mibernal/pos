import { createHash } from 'node:crypto';
import { env } from '../../../app/env.js';
import type { IPaymentGateway, PaymentIntentInput, PaymentWebhookResult } from './payment-gateway.interface.js';

export class WompiGateway implements IPaymentGateway {
  private readonly publicKey = env.WOMPI_PUBLIC_KEY || 'pub_test_XXXX';
  private readonly eventsKey = env.WOMPI_EVENTS_KEY || 'events_test_XXXX';

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
      rawPayload: payload
    };
  }
}
