import React from 'react';
import { formatMoneyFromCents } from '../../../../lib/format';
import { sendToPaymentTerminal } from '../../../../lib/hardware';

export function TerminalPaymentPanel({
  totalCents,
  cardApprovalCode,
  setCardApprovalCode,
  terminalProcessing,
  setTerminalProcessing,
  terminalError,
  setTerminalError,
  terminalSuccess,
  setTerminalSuccess
}: {
  totalCents: number;
  cardApprovalCode: string;
  setCardApprovalCode: (val: string) => void;
  terminalProcessing: boolean;
  setTerminalProcessing: (val: boolean) => void;
  terminalError: string | null;
  setTerminalError: (val: string | null) => void;
  terminalSuccess: boolean;
  setTerminalSuccess: (val: boolean) => void;
}) {
  
  async function handleTerminalCharge() {
    setTerminalProcessing(true);
    setTerminalError(null);
    try {
      const res = await sendToPaymentTerminal({
        ipAddress: '192.168.1.50', // Mock IP
        amountCents: totalCents,
        invoiceNumber: `T-${Date.now()}` // Mock Invoice
      });
      if (res.approved) {
        setTerminalSuccess(true);
      } else {
        setTerminalError(res.errorMessage || 'Transacción denegada');
      }
    } catch (_err) {
      setTerminalError('Error conectando al datáfono');
    } finally {
      setTerminalProcessing(false);
    }
  }

  return (
    <div className="checkout-section stack-md">
      <div className="section-heading">
        <div>
          <h3>Tarjeta</h3>
          <p>Se cobrará el total exacto a través del datáfono.</p>
        </div>
      </div>

      <div className="checkout-exact-charge">
        <span>Total a procesar</span>
        <strong>{formatMoneyFromCents(totalCents)}</strong>
      </div>

      <label className="field" style={{ marginTop: '1rem' }}>
        <span>Código de Aprobación (Voucher)</span>
        <input
          type="text"
          placeholder="Ej. 123456"
          value={cardApprovalCode}
          onChange={(e) => setCardApprovalCode(e.target.value)}
        />
      </label>

      <div style={{ marginTop: '1rem' }}>
        <button 
          className="secondary-button" 
          type="button" 
          onClick={() => void handleTerminalCharge()}
          disabled={terminalProcessing || terminalSuccess}
        >
          {terminalProcessing ? 'Esperando al cliente (PIN)...' : terminalSuccess ? 'Aprobado ✅' : 'Cobrar con Datáfono (LAN)'}
        </button>
        {terminalError && <p style={{ color: 'var(--color-red-600)', marginTop: '0.5rem', fontSize: '0.875rem' }}>{terminalError}</p>}
      </div>
    </div>
  );
}
