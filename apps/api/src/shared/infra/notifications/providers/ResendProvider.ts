import { Resend } from 'resend';
import { env } from '../../../../app/env.js';
import { NotificationProvider, EmailOptions } from '../NotificationProvider.js';

export class ResendProvider extends NotificationProvider {
  private resend: Resend;

  constructor() {
    super();
    // Defaulting to a placeholder if missing just to prevent crash in dev
    this.resend = new Resend(env.RESEND_API_KEY || 're_placeholder_key');
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    if (!env.RESEND_API_KEY) {
      console.warn('[ResendProvider] RESEND_API_KEY no está configurada. Email no enviado.', options.subject);
      return;
    }

    try {
      const response = await this.resend.emails.send({
        from: 'POS <notificaciones@tu-dominio.com>', // TODO: configurar dominio verificado
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: options.html
      });
      
      if (response.error) {
        console.error('[ResendProvider] Error al enviar email:', response.error);
      }
    } catch (err) {
      console.error('[ResendProvider] Error crítico enviando email:', err);
    }
  }
}
