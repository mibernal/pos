import { NotificationProvider, type EmailOptions } from '../NotificationProvider.js';

/**
 * Proveedor que no envía nada.
 *
 * Para la instalación local sin internet: ahí no hay a dónde mandar un correo, y fallar en
 * cada alta de usuario o alerta de stock solo llenaría el log de errores que no lo son.
 * Se deja una línea informativa para que quede rastro de qué se habría enviado.
 */
export class NullProvider extends NotificationProvider {
  async sendEmail(options: EmailOptions): Promise<void> {
    const to = Array.isArray(options.to) ? options.to.join(', ') : options.to;
    console.info(`[NullProvider] Correo no enviado (NOTIFICATION_PROVIDER=NONE): «${options.subject}» → ${to}`);
  }
}
