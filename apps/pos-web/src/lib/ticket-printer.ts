import { formatMoneyFromCents } from './format';
import type { TicketTemplateConfig } from './ticket-template';

export interface TicketPrintItem {
  name: string;
  qty: number;
  priceCents: number;
  lineTotalCents: number;
}

export interface TicketPrintPayment {
  method: 'CASH' | 'CARD' | 'TRANSFER';
  amountCents: number;
}

export interface TicketPrintInput {
  template: TicketTemplateConfig;
  branchName: string;
  branchAddress?: string;
  saleNumber: number;
  createdAt: string;
  saleStatus?: 'COMPLETED' | 'VOID';
  items: TicketPrintItem[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  payments: TicketPrintPayment[];
  taxMode?: 'IVA' | 'INC_RESTAURANT' | 'REGIMEN_SIMPLIFICADO' | null;
  dianStatus: 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED' | string;
  cude?: string | null;
  voidReason?: string | null;
  voidedAt?: string | null;
  isReprint?: boolean;
}

export interface ZReportTicketInput {
  template: TicketTemplateConfig;
  branchName: string;
  openedAt: string;
  closedAt: string | null;
  saleCount: number;
  totalSalesCents: number;
  paymentBreakdown: Record<string, number>;
  expectedCashCents: number;
  realCashCents: number;
  diffCents: number;
  status: string;
}

function formatDateTimeParts(value: string): { date: string; time: string } {
  const date = new Date(value);

  return {
    date: date.toLocaleDateString('es-CO'),
    time: date.toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit'
    })
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function paymentMethodLabel(method: TicketPrintPayment['method']): string {
  if (method === 'CASH') {
    return 'Efectivo';
  }
  if (method === 'CARD') {
    return 'Tarjeta';
  }
  return 'Transferencia';
}

function taxModeLabel(taxMode: TicketPrintInput['taxMode']): string | null {
  if (!taxMode) {
    return null;
  }

  return taxMode === 'INC_RESTAURANT' ? 'Incluye INC' : 'Incluye IVA';
}

function formatStatusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

export function extractTicketPayments(paymentJson: unknown): TicketPrintPayment[] {
  if (!paymentJson || typeof paymentJson !== 'object') {
    return [];
  }

  const rawPayments = (paymentJson as { payments?: unknown }).payments;
  if (!Array.isArray(rawPayments)) {
    return [];
  }

  return rawPayments
    .map((payment) => {
      if (!payment || typeof payment !== 'object') {
        return null;
      }

      const method = (payment as { method?: unknown }).method;
      const amount = (payment as { amount_cents?: unknown }).amount_cents;

      if (
        (method !== 'CASH' && method !== 'CARD' && method !== 'TRANSFER') ||
        typeof amount !== 'number' ||
        !Number.isFinite(amount)
      ) {
        return null;
      }

      return {
        method,
        amountCents: Math.round(amount)
      } satisfies TicketPrintPayment;
    })
    .filter((payment): payment is TicketPrintPayment => payment !== null);
}

export function buildTicketHtml(input: TicketPrintInput): string {
  const itemsHtml = input.items
    .map((item) => {
      return `<tr>
        <td class="qty-cell">${item.qty}</td>
        <td>
          <div class="item-name">${escapeHtml(item.name)}</div>
          <div class="item-meta">${formatMoneyFromCents(item.priceCents)} c/u</div>
        </td>
        <td class="amount-cell">${formatMoneyFromCents(item.lineTotalCents)}</td>
      </tr>`;
    })
    .join('');

  const paymentsHtml =
    input.payments.length > 0
      ? input.payments
        .map((payment) => {
          return `<div class="row"><span>${paymentMethodLabel(payment.method)}</span><strong>${formatMoneyFromCents(
            payment.amountCents
          )}</strong></div>`;
        })
        .join('')
      : '<div class="row"><span>Pago</span><strong>No disponible</strong></div>';

  const logoHtml = input.template.logoUrl
    ? `<div class="logo-wrap"><img src="${escapeHtml(input.template.logoUrl)}" alt="Logo negocio" /></div>`
    : '';

  const cudeHtml = input.cude
    ? `<div class="summary-row">
         <span>CUDE</span>
         <strong class="summary-value summary-value-code">${escapeHtml(input.cude)}</strong>
       </div>`
    : '';

  const includesTaxLabel = taxModeLabel(input.taxMode);
  const includesTaxHtml = includesTaxLabel
    ? `<div class="tax-pill">${escapeHtml(includesTaxLabel)}</div>`
    : '';

  const voidNoticeHtml =
    input.saleStatus === 'VOID'
      ? `<div class="void-alert">VENTA ANULADA</div>
         ${input.voidedAt
        ? `<div class="summary-row">
                  <span>Anulada en</span>
                  <strong>${escapeHtml(new Date(input.voidedAt).toLocaleString('es-CO'))}</strong>
                </div>`
        : ''
      }
         ${input.voidReason
        ? `<div class="summary-row">
                  <span>Motivo</span>
                  <strong>${escapeHtml(input.voidReason)}</strong>
                </div>`
        : ''
      }`
      : '';

  const createdAt = formatDateTimeParts(input.createdAt);
  const reprintHtml = input.isReprint
    ? `<div class="void-alert" style="color: #475569; background: #e2e8f0; border-color: #cbd5e1;">*** COPIA ***</div>`
    : '';

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Ticket Venta #${input.saleNumber}</title>
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
      .business-address {
        margin-top: 6px;
        text-align: center;
      }
      .divider {
        margin: 12px 0;
        border: 0;
        border-top: 1px dashed #94a3b8;
      }
      .sale-summary {
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
      .summary-value-code {
        max-width: 64%;
        word-break: break-word;
      }
      .tax-pill {
        display: inline-flex;
        justify-content: center;
        align-items: center;
        min-height: 28px;
        border-radius: 999px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        padding: 0 10px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
      }
      .void-alert {
        margin: 4px 0 2px;
        border: 1px solid #fecaca;
        border-radius: 8px;
        padding: 8px 10px;
        text-align: center;
        color: #9f1239;
        background: #fff1f2;
        font-weight: 800;
        letter-spacing: 0.04em;
      }
      .table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      .table th {
        text-align: left;
        border-bottom: 1px solid #cbd5e1;
        padding-bottom: 6px;
        color: #475569;
      }
      .table td {
        padding-top: 7px;
        vertical-align: top;
        border-bottom: 1px solid #eef2f7;
      }
      .qty-cell {
        width: 16%;
        text-align: center;
      }
      .amount-cell {
        width: 28%;
        text-align: right;
        white-space: nowrap;
      }
      .item-name {
        font-weight: 700;
      }
      .item-meta {
        margin-top: 2px;
        font-size: 11px;
        color: #64748b;
      }
      .totals, .payments {
        font-size: 13px;
        display: grid;
        gap: 6px;
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .payments-title {
        text-align: center;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #475569;
      }
      .totals .row.total-row {
        margin-top: 2px;
        padding-top: 8px;
        border-top: 1px solid #cbd5e1;
        font-size: 16px;
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
        body {
          background: #fff;
          padding: 0;
          margin: 0;
        }
        .ticket {
          border: none;
          border-radius: 0;
          box-shadow: none;
          width: 100%;
          padding: 0;
        }
        .print-actions {
          display: none;
        }
      }
    </style>
  </head>
  <body>
    <article class="ticket">
      ${logoHtml}
      <header class="ticket-header">
        <div class="ticket-kicker">Ticket de venta</div>
        <h1>${escapeHtml(input.template.businessName)}</h1>
        ${reprintHtml}
        <div class="meta"><strong>NIT:</strong> ${escapeHtml(input.template.nit)}</div>
        <div class="meta"><strong>Sucursal:</strong> ${escapeHtml(input.branchName)}</div>
        ${input.branchAddress
      ? `<div class="meta business-address">${escapeHtml(input.branchAddress)}</div>`
      : ''
    }
        <div class="meta business-address">${escapeHtml(input.template.address)}</div>
        ${input.template.phone
      ? `<div class="meta business-address"><strong>Tel:</strong> ${escapeHtml(
        input.template.phone
      )}</div>`
      : ''
    }
      </header>
      <hr class="divider" />
      <section class="sale-summary">
        <div class="summary-row">
          <span>Número de venta</span>
          <strong>#${input.saleNumber}</strong>
        </div>
        <div class="summary-row">
          <span>Fecha</span>
          <strong>${escapeHtml(createdAt.date)}</strong>
        </div>
        <div class="summary-row">
          <span>Hora</span>
          <strong>${escapeHtml(createdAt.time)}</strong>
        </div>
        <div class="summary-row">
          <span>Estado venta</span>
          <strong>${escapeHtml(formatStatusLabel(input.saleStatus ?? 'COMPLETED'))}</strong>
        </div>
        <div class="summary-row">
          <span>Estado DIAN</span>
          <strong>${escapeHtml(formatStatusLabel(input.dianStatus))}</strong>
        </div>
        ${cudeHtml}
        ${voidNoticeHtml}
        ${includesTaxHtml}
      </section>
      <hr class="divider" />
      <table class="table">
        <thead>
          <tr>
            <th style="text-align:center;">Cant</th>
            <th>Item</th>
            <th style="text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>
      <hr class="divider" />
      <section class="totals">
        <div class="row"><span>Subtotal</span><strong>${formatMoneyFromCents(input.subtotalCents)}</strong></div>
        <div class="row"><span>Descuento</span><strong>-${formatMoneyFromCents(input.discountCents)}</strong></div>
        <div class="row total-row"><span>Total</span><strong>${formatMoneyFromCents(input.totalCents)}</strong></div>
      </section>
      <hr class="divider" />
      <section class="payments">
        <div class="payments-title">Pagos</div>
        ${paymentsHtml}
      </section>
      <div class="ticket-footer">
        ${escapeHtml(input.template.footerMessage || 'Gracias por tu compra')}
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

export function printSaleTicket(input: TicketPrintInput): void {
  const printWindow = window.open('', '_blank', 'width=440,height=900');
  if (!printWindow) {
    return;
  }

  const html = buildTicketHtml(input);
  printWindow.document.write(html);
  printWindow.document.close();
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
export async function printSaleTicketESCPOS(input: TicketPrintInput): Promise<void> {
  if (!('serial' in navigator)) {
    throw new Error('Web Serial API no está soportada en este navegador (requiere Chrome/Edge y HTTPS).');
  }

  // Comandos ESC/POS básicos
  const ESC = 0x1b;
  const GS = 0x1d;
  const LF = 0x0a;

  const initPrinter = [ESC, 0x40];
  const alignCenter = [ESC, 0x61, 1];
  const alignLeft = [ESC, 0x61, 0];
  const boldOn = [ESC, 0x45, 1];
  const boldOff = [ESC, 0x45, 0];
  const cutPaper = [GS, 0x56, 0x41, 0x10]; // Cut paper (partial)

  const encoder = new TextEncoder();
  const data: number[] = [];

  const pushCmd = (cmd: number[]) => data.push(...cmd);
  const pushText = (text: string) => {
    // Normalizar a ASCII básico sin acentos (opcional: usar codepage)
    const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    data.push(...encoder.encode(normalized));
  };
  const pushLine = (text: string = '') => {
    pushText(text);
    data.push(LF);
  };

  // 1. Init
  pushCmd(initPrinter);
  pushCmd(alignCenter);

  // 2. Header
  pushCmd(boldOn);
  pushLine(input.template.businessName);
  pushCmd(boldOff);
  if (input.isReprint) {
    pushLine('*** COPIA ***');
  }
  pushLine(`NIT: ${input.template.nit}`);
  pushLine(`Sucursal: ${input.branchName}`);
  if (input.branchAddress) pushLine(input.branchAddress);
  pushLine(input.template.address);
  if (input.template.phone) pushLine(`Tel: ${input.template.phone}`);

  pushLine('--------------------------------');

  // 3. Info de Venta
  pushCmd(alignLeft);
  pushLine(`Venta #${input.saleNumber}`);
  const { date, time } = formatDateTimeParts(input.createdAt);
  pushLine(`Fecha: ${date} ${time}`);
  if (input.dianStatus !== 'PENDING') pushLine(`DIAN: ${formatStatusLabel(input.dianStatus)}`);
  if (input.cude) pushLine(`CUDE: ${input.cude.substring(0, 32)}...`);

  pushLine('--------------------------------');

  // 4. Items
  input.items.forEach(item => {
    // Nombre del item en una linea
    pushCmd(boldOn);
    pushLine(`${item.qty}x ${item.name}`);
    pushCmd(boldOff);
    // Precios
    const totalStr = formatMoneyFromCents(item.lineTotalCents);
    pushLine(`  ${formatMoneyFromCents(item.priceCents)} c/u -> ${totalStr}`);
  });

  pushLine('--------------------------------');

  // 5. Totales
  pushCmd(alignLeft);
  pushLine(`Subtotal:  ${formatMoneyFromCents(input.subtotalCents)}`);
  if (input.discountCents > 0) {
    pushLine(`Descuento: -${formatMoneyFromCents(input.discountCents)}`);
  }
  pushCmd(boldOn);
  pushLine(`TOTAL:     ${formatMoneyFromCents(input.totalCents)}`);
  pushCmd(boldOff);

  pushLine('--------------------------------');

  // 6. Pagos
  pushLine('PAGOS:');
  input.payments.forEach(p => {
    pushLine(`${paymentMethodLabel(p.method)}: ${formatMoneyFromCents(p.amountCents)}`);
  });

  pushLine('--------------------------------');

  // 7. Footer
  pushCmd(alignCenter);
  pushLine(input.template.footerMessage || 'Gracias por tu compra');

  pushLine();
  pushLine();
  pushLine();
  pushCmd(cutPaper);

  // Ejecutar escritura en puerto serie
  try {
    const nav = navigator as Navigator & { serial: { requestPort: () => Promise<{ open: (opts: { baudRate: number }) => Promise<void>; writable: WritableStream; close: () => Promise<void> }> } };
    const port = await nav.serial.requestPort();
    await port.open({ baudRate: 9600 });

    const writer = port.writable.getWriter();
    const uint8Array = new Uint8Array(data);
    await writer.write(uint8Array);
    await writer.releaseLock();

    await port.close();
  } catch (err) {
    throw new Error(`Fallo al imprimir por serial: ${err instanceof Error ? err.message : String(err)}`);
  }
}
