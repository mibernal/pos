/**
 * Integración con Básculas (Web Serial API)
 */
export async function readScaleWeight(): Promise<number> {
  if (!('serial' in navigator)) {
    throw new Error('Web Serial API no está soportada en este navegador.');
  }

  try {
    const port = await (navigator as any).serial.requestPort();
    await port.open({ baudRate: 9600 }); // Baud rate común para básculas (Mettler, Cas, etc.)
    
    const reader = port.readable.getReader();
    const decoder = new TextDecoder();
    let weightString = '';
    
    // Leemos por 1 segundo o hasta encontrar un retorno de carro
    const timeout = new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Timeout de báscula')), 2000));
    
    const readTask = async () => {
      let active = true;
    while (active) {
        const { value, done } = await reader.read();
        if (done) break;
        
        weightString += decoder.decode(value);
        if (weightString.includes('\r') || weightString.includes('\n')) {
          break;
        }
      }
    };
    
    await Promise.race([readTask(), timeout]);
    
    await reader.cancel();
    await reader.releaseLock();
    await port.close();
    
    // Limpiar string de báscula (ej. "  0.450 kg\r\n" -> 0.450)
    const cleaned = weightString.replace(/[^0-9.]/g, '');
    const weight = parseFloat(cleaned);
    
    if (isNaN(weight)) {
      throw new Error('Formato de báscula irreconocible: ' + weightString);
    }
    
    return weight;
  } catch (err) {
    throw new Error(`Error al leer báscula: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * API LAN (Mock) para Datáfonos (Ej. Redeban / Credibanco)
 * Estas APIs usualmente operan enviando un payload HTTP a la IP local del datáfono o su concentrador.
 */
export interface PaymentTerminalRequest {
  ipAddress: string;
  amountCents: number;
  taxAmountCents?: number;
  invoiceNumber: string;
}

export interface PaymentTerminalResponse {
  approved: boolean;
  authorizationCode?: string;
  cardFranchise?: string;
  lastFour?: string;
  errorMessage?: string;
}

export async function sendToPaymentTerminal(req: PaymentTerminalRequest): Promise<PaymentTerminalResponse> {
  // Simulador: en la vida real esto hace fetch(`http://${req.ipAddress}:8080/v1/payment`, ...)
  return new Promise((resolve) => {
    console.log(`[Datáfono ${req.ipAddress}] Solicitando pago por ${req.amountCents} centavos...`);
    
    setTimeout(() => {
      const isApproved = Math.random() > 0.1; // 90% aprobación simulada
      if (isApproved) {
        resolve({
          approved: true,
          authorizationCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
          cardFranchise: 'VISA',
          lastFour: '1234'
        });
      } else {
        resolve({
          approved: false,
          errorMessage: 'Fondos insuficientes o PIN incorrecto'
        });
      }
    }, 2500); // 2.5s simulando tiempo de PIN
  });
}
