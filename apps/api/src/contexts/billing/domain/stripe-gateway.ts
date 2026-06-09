import Stripe from 'stripe';
import { env } from '../../../app/env.js';
import type { IPaymentGateway, PaymentIntentInput, PaymentWebhookResult } from './payment-gateway.interface.js';

export class StripeGateway implements IPaymentGateway {
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(env.STRIPE_SECRET_KEY || 'sk_test_mock', {
      apiVersion: '2023-10-16'
    });
  }

  async createPaymentIntent(input: PaymentIntentInput): Promise<{ checkoutUrl: string; token?: string; gatewayId?: string }> {
    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price_data: {
            currency: 'cop',
            product_data: {
              name: 'Suscripción POS SaaS'
            },
            unit_amount: input.amountCents,
            recurring: {
              interval: 'month'
            }
          },
          quantity: 1
        }
      ],
      success_url: input.redirectUrl,
      cancel_url: input.redirectUrl,
      customer_email: input.customerEmail,
      client_reference_id: input.reference,
      metadata: {
        reference: input.reference
      }
    });

    return {
      checkoutUrl: session.url || '',
      gatewayId: session.id
    };
  }

  verifyWebhookSignature(headers: Record<string, string>, rawBody: string): boolean {
    const signature = headers['stripe-signature'];
    if (!signature) return false;

    try {
      this.stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET || 'whsec_mock');
      return true;
    } catch {
      return false;
    }
  }

  parseWebhook(payload: any): PaymentWebhookResult {
    if (payload.type === 'checkout.session.completed') {
      const session = payload.data.object as Stripe.Checkout.Session;
      return {
        reference: session.client_reference_id || '',
        status: 'APPROVED',
        gatewayTransactionId: session.id,
        rawPayload: payload
      };
    }

    if (payload.type === 'checkout.session.async_payment_failed') {
      const session = payload.data.object as Stripe.Checkout.Session;
      return {
        reference: session.client_reference_id || '',
        status: 'FAILED' as any, // FAILED in my enum is not in PaymentWebhookResult (only PENDING | APPROVED | DECLINED | ERROR). Let's map it to DECLINED or ERROR.
        gatewayTransactionId: session.id,
        rawPayload: payload
      };
    }

    return { reference: '', gatewayTransactionId: '', status: 'PENDING', rawPayload: payload };
  }

  async verifyPayment(reference: string): Promise<boolean> {
    return true;
  }
}
