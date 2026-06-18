import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { NotificationProvider } from './NotificationProvider.js';
import { EmailTemplates } from './EmailTemplates.js';
import {
  TenantWelcomePayload,
  LowStockPayload,
  SubscriptionExpiringPayload,
  PaymentApprovedPayload,
  PaymentRejectedPayload,
  PlanChangePayload
} from './NotificationEvents.js';
import { ResendProvider } from './providers/ResendProvider.js';
import { SendGridProvider } from './providers/SendGridProvider.js';
import { env } from '../../../app/env.js';

export class NotificationService {
  private provider: NotificationProvider;

  constructor(private db: Kysely<Database>) {
    // Strategy selection based on environment configuration
    // Fallback to ResendProvider if nothing explicitly defined
    const providerType = env.NOTIFICATION_PROVIDER || 'RESEND';
    
    if (providerType === 'SENDGRID') {
      this.provider = new SendGridProvider();
    } else {
      this.provider = new ResendProvider();
    }
  }

  /**
   * Obtiene el email del owner del tenant.
   */
  private async getTenantOwnerEmail(tenantId: string): Promise<string | null> {
    const owner = await this.db
      .selectFrom('users')
      .select(['email'])
      .where('tenant_id', '=', tenantId)
      .where('role', '=', 'TENANT_OWNER')
      .executeTakeFirst();
    
    return owner?.email || null;
  }

  // --- Casos de Uso (Notificaciones específicas) ---

  async notifyTenantWelcome(tenantId: string, email: string, payload: TenantWelcomePayload) {
    const template = EmailTemplates.getTenantWelcome(payload);
    await this.provider.sendEmail({
      to: email,
      subject: template.subject,
      html: template.html
    });
  }

  async notifyLowStock(tenantId: string, payload: LowStockPayload) {
    const email = await this.getTenantOwnerEmail(tenantId);
    if (!email) return;

    const template = EmailTemplates.getLowStock(payload);
    await this.provider.sendEmail({
      to: email,
      subject: template.subject,
      html: template.html
    });
  }

  async notifySubscriptionExpiring(tenantId: string, payload: SubscriptionExpiringPayload) {
    const email = await this.getTenantOwnerEmail(tenantId);
    if (!email) return;

    const template = EmailTemplates.getSubscriptionExpiring(payload);
    await this.provider.sendEmail({
      to: email,
      subject: template.subject,
      html: template.html
    });
  }

  async notifyPaymentApproved(tenantId: string, payload: PaymentApprovedPayload) {
    const email = await this.getTenantOwnerEmail(tenantId);
    if (!email) return;

    const template = EmailTemplates.getPaymentApproved(payload);
    await this.provider.sendEmail({
      to: email,
      subject: template.subject,
      html: template.html
    });
  }

  async notifyPaymentRejected(tenantId: string, payload: PaymentRejectedPayload) {
    const email = await this.getTenantOwnerEmail(tenantId);
    if (!email) return;

    const template = EmailTemplates.getPaymentRejected(payload);
    await this.provider.sendEmail({
      to: email,
      subject: template.subject,
      html: template.html
    });
  }

  async notifyPlanChanged(tenantId: string, payload: PlanChangePayload) {
    const email = await this.getTenantOwnerEmail(tenantId);
    if (!email) return;

    const template = EmailTemplates.getPlanChange(payload);
    await this.provider.sendEmail({
      to: email,
      subject: template.subject,
      html: template.html
    });
  }
}
