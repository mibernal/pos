import {
  TenantWelcomePayload,
  LowStockPayload,
  SubscriptionExpiringPayload,
  PaymentApprovedPayload,
  PaymentRejectedPayload,
  PlanChangePayload,
  RenewalReminderPayload,
  ChargeFailedPayload,
  SubscriptionSuspendedPayload,
  InvoicePaidPayload
} from './NotificationEvents.js';

/**
 * Los importes se guardan en centavos y hay que escribirlos como pesos.
 *
 * El correo de pago aprobado decía «Tu pago por 4990000 COP ha sido aprobado»: técnicamente
 * cierto, ilegible para quien lo recibe, y suficiente para que un comercio crea que le
 * cobraron cuatro millones de más.
 */
function pesos(amountCents: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(Math.round(amountCents) / 100);
}

const SHELL_OPEN = '<div style="font-family: sans-serif; padding: 20px; color: #111827; line-height: 1.5;">';

function boton(url: string, texto: string): string {
  return `<p><a href="${url}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">${texto}</a></p>`;
}

export const EmailTemplates = {
  getTenantWelcome(payload: TenantWelcomePayload) {
    return {
      subject: `¡Bienvenido al POS, ${payload.ownerName}!`,
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Hola ${payload.ownerName},</h2>
          <p>Tu negocio <strong>${payload.tenantName}</strong> ha sido registrado exitosamente.</p>
          <p>Has iniciado con el plan <strong>${payload.planName}</strong>.</p>
          <p>¡Estamos felices de tenerte con nosotros! Si necesitas ayuda, no dudes en contactarnos.</p>
        </div>
      `
    };
  },

  getLowStock(payload: LowStockPayload) {
    return {
      subject: `Alerta de Stock Bajo: ${payload.productName}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2 style="color: #d97706;">Alerta de Inventario</h2>
          <p>El producto <strong>${payload.productName}</strong> en la sucursal <strong>${payload.branchName}</strong> está por debajo del umbral mínimo de seguridad.</p>
          <ul>
            <li>Cantidad Actual: ${payload.currentQty}</li>
            <li>Umbral de Alerta: ${payload.threshold}</li>
          </ul>
          <p>Por favor reabastece este producto a la brevedad posible para evitar interrupciones en tus ventas.</p>
        </div>
      `
    };
  },

  getSubscriptionExpiring(payload: SubscriptionExpiringPayload) {
    return {
      subject: `Tu suscripción vencerá pronto (${payload.daysRemaining} días)`,
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Atención ${payload.tenantName},</h2>
          <p>Te recordamos que tu plan <strong>${payload.planName}</strong> expira el próximo <strong>${payload.expirationDate}</strong> (en ${payload.daysRemaining} días).</p>
          <p>Asegúrate de tener un método de pago válido configurado para evitar la suspensión del servicio.</p>
        </div>
      `
    };
  },

  getPaymentApproved(payload: PaymentApprovedPayload) {
    return {
      subject: 'Pago aprobado exitosamente',
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>¡Gracias por tu pago, ${payload.tenantName}!</h2>
          <p>Tu pago por <strong>${pesos(payload.amount)}</strong> ha sido aprobado.</p>
          <p>Tu plan <strong>${payload.planName}</strong> se encuentra activo.</p>
          ${payload.receiptUrl ? `<p><a href="${payload.receiptUrl}">Ver recibo</a></p>` : ''}
        </div>
      `
    };
  },

  getPaymentRejected(payload: PaymentRejectedPayload) {
    return {
      subject: 'Acción Requerida: Pago rechazado',
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2 style="color: #dc2626;">Problemas con tu pago</h2>
          <p>Hola ${payload.tenantName},</p>
          <p>No pudimos procesar tu último pago. Razón provista: <strong>${payload.reason}</strong>.</p>
          <p>Para evitar interrupciones en el servicio, por favor actualiza tu método de pago.</p>
          ${payload.retryUrl ? `<p><a href="${payload.retryUrl}" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reintentar Pago</a></p>` : ''}
        </div>
      `
    };
  },

  getPlanChange(payload: PlanChangePayload) {
    return {
      subject: 'Confirmación de cambio de plan',
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Cambio de plan exitoso</h2>
          <p>Hola ${payload.tenantName}, confirmamos que tu suscripción ha sido actualizada.</p>
          <p>Plan anterior: <strong>${payload.oldPlanName}</strong></p>
          <p>Nuevo plan: <strong>${payload.newPlanName}</strong></p>
          <p>¡Disfruta de tus nuevos beneficios!</p>
        </div>
      `
    };
  },

  /**
   * Aviso previo a la renovación. Se envía a los 7 y a los 3 días, y el texto cambia según
   * haya medio de pago o no: sin él, el aviso no es un recordatorio sino una acción a
   * realizar, y decirle «no tienes que hacer nada» a quien sí tiene que hacer algo es la
   * forma más eficiente de perder un cliente por descuido.
   */
  getRenewalReminder(payload: RenewalReminderPayload) {
    const accion = payload.hasPaymentMethod
      ? `<p>El cobro de <strong>${pesos(payload.amountCents)}</strong> se hará automáticamente el <strong>${payload.renewalDate}</strong> con el medio de pago que tienes registrado. No tienes que hacer nada.</p>`
      : `<p>Tu plan se renueva el <strong>${payload.renewalDate}</strong> por <strong>${pesos(payload.amountCents)}</strong>, pero <strong>no tienes un medio de pago registrado</strong>. Regístralo antes de esa fecha para que el servicio no se interrumpa.</p>`;

    return {
      subject: `Tu plan ${payload.planName} se renueva en ${payload.daysRemaining} días`,
      html: `
        ${SHELL_OPEN}
          <h2>Hola ${payload.tenantName},</h2>
          ${accion}
          ${payload.portalUrl ? boton(payload.portalUrl, payload.hasPaymentMethod ? 'Ver mi facturación' : 'Registrar medio de pago') : ''}
        </div>
      `
    };
  },

  /**
   * Cobro rechazado. Dice el intento, cuándo es el siguiente y qué pasa si ninguno
   * prospera: un correo que solo dice «hubo un problema» obliga al comercio a llamar para
   * enterarse de lo que ya sabemos.
   */
  getChargeFailed(payload: ChargeFailedPayload) {
    const siguiente = payload.nextRetryDate
      ? `<p>Volveremos a intentarlo el <strong>${payload.nextRetryDate}</strong> (intento ${payload.attempt} de ${payload.totalAttempts}).</p>`
      : `<p>Este era el último de los ${payload.totalAttempts} intentos.${payload.suspensionDate ? ` Si no se resuelve, la cuenta se suspenderá el <strong>${payload.suspensionDate}</strong>.` : ''}</p>`;

    return {
      subject: `No pudimos cobrar tu plan ${payload.planName}`,
      html: `
        ${SHELL_OPEN}
          <h2 style="color: #dc2626;">No pudimos procesar el cobro</h2>
          <p>Hola ${payload.tenantName},</p>
          <p>El cobro de <strong>${pesos(payload.amountCents)}</strong> fue rechazado. Motivo informado por el banco: <strong>${payload.reason}</strong>.</p>
          ${siguiente}
          <p>Tu punto de venta sigue funcionando con normalidad mientras tanto: lo que se restringe temporalmente son los informes y la configuración.</p>
          ${payload.portalUrl ? boton(payload.portalUrl, 'Actualizar medio de pago') : ''}
        </div>
      `
    };
  },

  getSubscriptionSuspended(payload: SubscriptionSuspendedPayload) {
    return {
      subject: 'Tu suscripción quedó suspendida',
      html: `
        ${SHELL_OPEN}
          <h2 style="color: #dc2626;">Suscripción suspendida</h2>
          <p>Hola ${payload.tenantName},</p>
          <p>Agotamos los intentos de cobro de tu plan <strong>${payload.planName}</strong> y el periodo de gracia terminó el <strong>${payload.suspendedOn}</strong>, así que la cuenta quedó suspendida.</p>
          <p><strong>Tu información sigue intacta.</strong> Con un pago de <strong>${pesos(payload.amountCents)}</strong> la cuenta se reactiva y todo vuelve a estar donde lo dejaste.</p>
          ${payload.portalUrl ? boton(payload.portalUrl, 'Reactivar mi cuenta') : ''}
        </div>
      `
    };
  },

  getInvoicePaid(payload: InvoicePaidPayload) {
    return {
      subject: `Factura ${payload.invoiceNumber} — pago recibido`,
      html: `
        ${SHELL_OPEN}
          <h2>Gracias, ${payload.tenantName}</h2>
          <p>Recibimos el pago de tu plan <strong>${payload.planName}</strong>.</p>
          <table style="border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 4px 16px 4px 0; color: #6b7280;">Factura</td><td style="padding: 4px 0;"><strong>${payload.invoiceNumber}</strong></td></tr>
            <tr><td style="padding: 4px 16px 4px 0; color: #6b7280;">Periodo</td><td style="padding: 4px 0;">${payload.periodStart} — ${payload.periodEnd}</td></tr>
            <tr><td style="padding: 4px 16px 4px 0; color: #6b7280;">Total</td><td style="padding: 4px 0;"><strong>${pesos(payload.amountCents)}</strong></td></tr>
          </table>
          ${payload.portalUrl ? boton(payload.portalUrl, 'Descargar factura') : ''}
        </div>
      `
    };
  }
};
