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

    const data = await response.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
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

  async parseWebhook(payload: any): Promise<PaymentWebhookResult> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const dataId = payload?.data?.id;

    if (!dataId) {
      return {
        reference: '',
        gatewayTransactionId: '',
        status: 'ERROR',
        rawPayload: payload
      };
    }

    try {
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      if (!response.ok) {
        return {
          reference: '',
          gatewayTransactionId: dataId,
          status: 'ERROR',
          rawPayload: payload
        };
      }

      const payment = await response.json() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      const mpStatus = payment.status;

      let status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'ERROR' = 'ERROR';

      if (mpStatus === 'approved') {
        status = 'APPROVED';
      } else if (mpStatus === 'pending' || mpStatus === 'in_process' || mpStatus === 'authorized') {
        status = 'PENDING';
      } else if (mpStatus === 'rejected' || mpStatus === 'cancelled') {
        status = 'DECLINED';
      } else if (mpStatus === 'refunded' || mpStatus === 'charged_back') {
        status = 'ERROR';
      }

      return {
        reference: payment.external_reference || '',
        gatewayTransactionId: dataId.toString(),
        status,
        rawPayload: payload
      };
    } catch {
      return {
        reference: '',
        gatewayTransactionId: dataId,
        status: 'ERROR',
        rawPayload: payload
      };
    }
  }
}
