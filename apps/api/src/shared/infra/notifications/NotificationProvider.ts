import {
  TenantWelcomePayload,
  LowStockPayload,
  SubscriptionExpiringPayload,
  PaymentApprovedPayload,
  PaymentRejectedPayload,
  PlanChangePayload
} from './NotificationEvents.js';

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
}

export abstract class NotificationProvider {
  /**
   * Enviar un email base
   */
  abstract sendEmail(options: EmailOptions): Promise<void>;

  // A futuro: SMS, Push, Webhooks
  // abstract sendSMS(to: string, message: string): Promise<void>;
  // abstract sendPush(userId: string, title: string, body: string): Promise<void>;
  // abstract sendWebhook(url: string, payload: any): Promise<void>;
}
