import type { KitchenTicketInput } from './types';
import { escapeHtml, formatDateTimeParts } from './format';

export function buildKitchenTicketHtml(input: KitchenTicketInput): string {
  const itemsHtml = input.items
    .map((item) => {
      return `<tr>
        <td class="qty-cell" style="font-size: 1.2rem; font-weight: bold;">${item.qty}</td>
        <td>
          <div class="item-name" style="font-size: 1.2rem; font-weight: bold;">${escapeHtml(item.name)}</div>
          ${item.notes ? `<div class="item-meta" style="font-style: italic; font-size: 1rem; color: #b91c1c;">Nota: ${escapeHtml(item.notes)}</div>` : ''}
        </td>
      </tr>`;
    })
    .join('');

  const { time } = formatDateTimeParts(input.createdAt);

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Comanda - ${escapeHtml(input.tableName)}</title>
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
        width: 360px;
        border: 1px solid #d6dbe4;
        border-radius: 14px;
        padding: 14px;
        background: #ffffff;
        box-shadow: 0 18px 36px rgba(15, 23, 42, 0.12);
      }
      .ticket-header { text-align: center; margin-bottom: 12px; }
      h1 { margin: 0; font-size: 24px; text-transform: uppercase; }
      .meta { margin-top: 3px; font-size: 14px; color: #334155; }
      .items-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
      .items-table td { padding: 8px 0; border-bottom: 1px dashed #cbd5e1; }
      .qty-cell { width: 40px; text-align: left; vertical-align: top; }
    </style>
  </head>
  <body>
    <div class="ticket">
      <div class="ticket-header">
        <h1>MESA ${escapeHtml(input.tableName)}</h1>
        ${input.waiterName ? `<div class="meta">Mesero: <strong>${escapeHtml(input.waiterName)}</strong></div>` : ''}
        <div class="meta">Hora: ${time}</div>
      </div>
      <table class="items-table">
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>
    </div>
  </body>
</html>`;
}

export function printKitchenTicket(input: KitchenTicketInput): void {
  const printWindow = window.open('', '_blank', 'width=440,height=900');
  if (!printWindow) {
    return;
  }

  const html = buildKitchenTicketHtml(input);
  printWindow.document.write(html);
  printWindow.document.close();
}

export async function printKitchenTicketESCPOS(input: KitchenTicketInput): Promise<void> {
  if (!('serial' in navigator)) {
    throw new Error('Tu navegador no soporta la API Web Serial (requiere Chrome/Edge).');
  }

  const data: number[] = [];
  const pushCmd = (cmd: number[]) => data.push(...cmd);
  const pushStr = (str: string) => {
    // Basic mapping to ascii without accents to avoid problems with different code pages
    const cleaned = str.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");
    for (let i = 0; i < cleaned.length; i++) {
      data.push(cleaned.charCodeAt(i));
    }
  };
  const pushLine = (str: string = '') => {
    if (str) pushStr(str);
    pushCmd(printLine);
  };

  const initPrinter = [0x1B, 0x40];
  const printLine = [0x0A];
  const cutPaper = [0x1D, 0x56, 0x00];
  const boldOn = [0x1B, 0x45, 0x01];
  const boldOff = [0x1B, 0x45, 0x00];
  const alignLeft = [0x1B, 0x61, 0x00];
  const alignCenter = [0x1B, 0x61, 0x01];
  const sizeDouble = [0x1D, 0x21, 0x11]; // Double height & width
  const sizeNormal = [0x1D, 0x21, 0x00];

  // 1. Init
  pushCmd(initPrinter);
  pushCmd(alignCenter);

  // 2. Header
  pushCmd(sizeDouble);
  pushCmd(boldOn);
  pushLine(`MESA ${input.tableName}`);
  pushCmd(sizeNormal);
  pushCmd(boldOff);

  const { time } = formatDateTimeParts(input.createdAt);
  if (input.waiterName) pushLine(`Mesero: ${input.waiterName}`);
  pushLine(`Hora: ${time}`);
  pushLine('--------------------------------');

  // 3. Items
  pushCmd(alignLeft);
  input.items.forEach(item => {
    pushCmd(sizeDouble);
    pushCmd(boldOn);
    pushLine(`${item.qty}x ${item.name}`);
    pushCmd(sizeNormal);
    pushCmd(boldOff);
    
    if (item.notes) {
      pushLine(`  >> NOTA: ${item.notes}`);
    }
    pushLine();
  });

  pushCmd(alignCenter);
  pushLine('--------------------------------');

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
