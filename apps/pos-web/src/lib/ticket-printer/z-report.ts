import { formatMoneyFromCents } from '../format';
import type { ZReportTicketInput } from './types';
import { escapeHtml, formatDateTimeParts } from './format';

export function buildZReportTicketHtml(input: ZReportTicketInput): string {
  const logoHtml = input.template.logoUrl
    ? `<div class="logo-wrap"><img src="${escapeHtml(input.template.logoUrl)}" alt="Logo negocio" /></div>`
    : '';

  const openedAt = formatDateTimeParts(input.openedAt);
  const closedAt = input.closedAt ? formatDateTimeParts(input.closedAt) : null;

  const paymentBreakdownHtml = Object.entries(input.paymentBreakdown)
    .filter(([, amount]) => amount > 0)
    .map(([method, amount]) => {
      const methodLabel = method === 'CASH' ? 'Efectivo' : method === 'CARD' ? 'Tarjeta' : method === 'TRANSFER' ? 'Transferencia' : method;
      return `<div class="row"><span>${methodLabel}</span><strong>${formatMoneyFromCents(amount)}</strong></div>`;
    })
    .join('');

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Reporte Z</title>
    <style>
      :root {
        color: #0f172a;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #eef2f7;
        display: grid;
        place-items: start center;
        padding: 16px;
      }
      .ticket {
        width: min(100%, ${input.template.printerWidth === '58mm' ? '280px' : '360px'});
        border: 1px solid #d6dbe4;
        border-radius: 14px;
        padding: 14px;
        background: #ffffff;
        box-shadow: 0 18px 36px rgba(15, 23, 42, 0.12);
      }
      .logo-wrap {
        text-align: center;
        margin-bottom: 10px;
      }
      .logo-wrap img {
        max-height: 48px;
        max-width: 100%;
        object-fit: contain;
      }
      .ticket-header {
        text-align: center;
      }
      .ticket-kicker {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #475569;
      }
      h1 {
        margin: 0;
        font-size: ${input.template.printerWidth === '58mm' ? '18px' : '20px'};
      }
      .meta {
        margin-top: 3px;
        font-size: 12px;
        color: #334155;
      }
      .divider {
        margin: 12px 0;
        border: 0;
        border-top: 1px dashed #94a3b8;
      }
      .summary-section {
        display: grid;
        gap: 7px;
      }
      .summary-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 8px;
        font-size: 12px;
      }
      .summary-row span {
        color: #475569;
      }
      .summary-row strong {
        text-align: right;
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 13px;
        margin-bottom: 6px;
      }
      .section-title {
        text-align: center;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #475569;
        margin-bottom: 8px;
      }
      .diff-row {
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid #cbd5e1;
      }
      .ticket-footer {
        margin-top: 12px;
        text-align: center;
        font-size: 11px;
        color: #64748b;
      }
      .print-actions {
        margin-top: 12px;
        display: flex;
        justify-content: center;
      }
      .print-actions button {
        border: 1px solid #1e293b;
        border-radius: 8px;
        padding: 8px 12px;
        background: #0f172a;
        color: #f8fafc;
        font-weight: 700;
        cursor: pointer;
      }
      @page {
        size: ${input.template.printerWidth === '58mm' ? '58mm' : '80mm'} auto;
        margin: 6mm;
      }
      @media print {
        body { background: #fff; padding: 0; margin: 0; }
        .ticket { border: none; border-radius: 0; box-shadow: none; width: 100%; padding: 0; }
        .print-actions { display: none; }
      }
    </style>
  </head>
  <body>
    <article class="ticket">
      ${logoHtml}
      <header class="ticket-header">
        <div class="ticket-kicker">Reporte Z</div>
        <h1>${escapeHtml(input.template.businessName)}</h1>
        <div class="meta"><strong>NIT:</strong> ${escapeHtml(input.template.nit)}</div>
        <div class="meta"><strong>Sucursal:</strong> ${escapeHtml(input.branchName)}</div>
      </header>
      <hr class="divider" />
      <section class="summary-section">
        <div class="summary-row">
          <span>Apertura</span>
          <strong>${escapeHtml(openedAt.date)} ${escapeHtml(openedAt.time)}</strong>
        </div>
        <div class="summary-row">
          <span>Cierre</span>
          <strong>${closedAt ? `${escapeHtml(closedAt.date)} ${escapeHtml(closedAt.time)}` : 'Pendiente'}</strong>
        </div>
        <div class="summary-row">
          <span>Estado Sesión</span>
          <strong>${input.status === 'CLOSED' ? 'CERRADA (Falta arqueo)' : input.status === 'RECONCILED' ? 'ARQUEADA' : input.status}</strong>
        </div>
      </section>
      <hr class="divider" />
      <section>
        <div class="section-title">Resumen de Ventas</div>
        <div class="row"><span>Ventas completadas</span><strong>${input.saleCount}</strong></div>
        <div class="row"><span>Total Ingresos</span><strong>${formatMoneyFromCents(input.totalSalesCents)}</strong></div>
      </section>
      <hr class="divider" />
      <section>
        <div class="section-title">Desglose de Medios</div>
        ${paymentBreakdownHtml || '<div class="row"><span>Sin ventas</span><strong>$0.00</strong></div>'}
      </section>
      <hr class="divider" />
      <section>
        <div class="section-title">Control de Efectivo</div>
        <div class="row"><span>Efectivo esperado</span><strong>${formatMoneyFromCents(input.expectedCashCents)}</strong></div>
        <div class="row"><span>Efectivo real</span><strong>${formatMoneyFromCents(input.realCashCents)}</strong></div>
        <div class="row diff-row"><span>Diferencia</span><strong>${input.diffCents > 0 ? '+' : ''}${formatMoneyFromCents(input.diffCents)}</strong></div>
      </section>
      <div class="ticket-footer">
        Corte de caja Z generado por el sistema
      </div>
      <div class="print-actions">
        <button type="button" onclick="window.print()">Imprimir</button>
      </div>
    </article>
    <script>
      window.addEventListener('load', () => {
        setTimeout(() => window.print(), 120);
      });
    </script>
  </body>
</html>`;
}

export function printZReportTicket(input: ZReportTicketInput): void {
  const printWindow = window.open('', '_blank', 'width=440,height=900');
  if (!printWindow) {
    return;
  }

  const html = buildZReportTicketHtml(input);
  printWindow.document.write(html);
  printWindow.document.close();
}

/**
 * Imprime un ticket directamente a una impresora ESC/POS a través de la Web Serial API (navigator.serial).
 * Requiere interacción del usuario y HTTPS (o localhost).
 */
