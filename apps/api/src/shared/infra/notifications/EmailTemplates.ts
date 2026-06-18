import {
  TenantWelcomePayload,
  LowStockPayload,
  SubscriptionExpiringPayload,
  PaymentApprovedPayload,
  PaymentRejectedPayload,
  PlanChangePayload
} from './NotificationEvents.js';

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
          <p>Tu pago por <strong>${payload.amount} ${payload.currency}</strong> ha sido aprobado.</p>
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
  }
};
