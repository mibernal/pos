import { NotificationProvider, EmailOptions } from '../NotificationProvider.js';

export class SendGridProvider extends NotificationProvider {
  constructor() {
    super();
    // Aquí inicializaríamos sgMail con la API KEY
    // sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    console.warn('[SendGridProvider] Adapter stubbed. Simulando envío...', options.subject);
    
    // const msg = {
    //   to: options.to,
    //   from: 'notificaciones@tu-dominio.com',
    //   subject: options.subject,
    //   html: options.html,
    // };
    // await sgMail.send(msg);
  }
}
