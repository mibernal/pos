import { createHmac } from 'node:crypto';
import { env } from '../../../app/env.js';
import type { IPaymentGateway, PaymentIntentInput, PaymentWebhookResult } from './payment-gateway.interface.js';

export class MercadoPagoGateway implements IPaymentGateway {
  private readonly accessToken = env.MERCADOPAGO_ACCESS_TOKEN || 'TEST-XXXX';
  private readonly webhookSecret = env.MERCADOPAGO_WEBHOOK_SECRET || 'XXXX';

  async createPaymentIntent(input: PaymentIntentInput): Promise<{ checkoutUrl: string; gatewayId?: string }> {
    // MercadoPago usa la API de Preferences para Checkout Pro.
    // Calculamos el valor base: centavos / 100
    const amount = input.amountCents / 100;
    
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: [
          {
            title: 'Suscripción POS SaaS',
            quantity: 1,
            unit_price: amount,
            currency_id: input.currency || 'COP'
          }
        ],
        payer: {
          email: input.customerEmail
        },
        external_reference: input.reference,
        back_urls: {
          success: input.redirectUrl,
          failure: input.redirectUrl,
          pending: input.redirectUrl
        },
        auto_return: 'approved'
      })
    });

    if (!response.ok) {
      throw new Error(`Error en MercadoPago: ${await response.text()}`);
    }

    const data = await response.json() as any;
    // data.init_point es la URL a redirigir al usuario para pagar (Checkout Pro)
    return { 
      checkoutUrl: data.init_point,
      gatewayId: data.id 
    };
  }

  verifyWebhookSignature(headers: Record<string, string>, rawBody: string): boolean {
    const xSignature = headers['x-signature'];
    const xRequestId = headers['x-request-id'];

    if (!xSignature || !xRequestId) return false;

    try {
      // Extraemos ts y v1 del header x-signature (ej: ts=123,v1=abc)
      const parts = xSignature.split(',');
      let ts = '';
      let v1 = '';
      for (const p of parts) {
        if (p.startsWith('ts=')) ts = p.substring(3);
        if (p.startsWith('v1=')) v1 = p.substring(3);
      }

      const urlParams = new URLSearchParams();
      // MercadoPago webhooks usualmente vienen con data.id en el payload de query params
      const payloadObj = JSON.parse(rawBody);
      const dataId = payloadObj?.data?.id || '';
      
      const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
      const hmac = createHmac('sha256', this.webhookSecret);
      hmac.update(manifest);
      const digest = hmac.digest('hex');

      return digest === v1;
    } catch {
      return false;
    }
  }

  parseWebhook(payload: any): PaymentWebhookResult {
    // Nota: MP normalmente envía solo notificaciones del ID de evento.
    // Aquí asumimos que obtenemos el status consultando o parseando un evento directo tipo 'payment'
    // En una implementación real más robusta, el Webhook solo informa ID, y se debe hacer un fetch() a la API de MP para ver el estado real de payment.
    const action = payload?.action;
    const type = payload?.type;
    
    // Si la arquitectura requiere ir por el payment:
    // (Asumido que para el MVP tomaremos el id y luego el caso de uso tendría que pedir la info real de MP, o que MP lo envíe)
    // Para cumplir el interface, parseamos lo que envía:
    return {
      reference: payload?.external_reference || '', // Puede venir o no dependiendo del evento
      gatewayTransactionId: payload?.data?.id || '',
      status: 'PENDING', // Debe resolverse luego consultando la API en el UseCase, o asumiendo el state de action
      rawPayload: payload
    };
  }
}
