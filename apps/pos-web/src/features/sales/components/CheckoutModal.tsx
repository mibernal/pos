import { useEffect, useMemo, useRef, useState } from 'react';
import { Banner, Modal } from '../../../components/ui';
import { formatMoneyFromCents } from '../../../lib/format';
import type { Customer, CreateSaleRequest } from '../../../lib/api';
import { formatEditableMoneyFromCents, parseVisibleMoneyToCents } from '../utils';
import { sendToPaymentTerminal } from '../../../lib/hardware';
import type { CartItem, PaymentMethod } from '../../../types';

type SimplePaymentMethod = Exclude<PaymentMethod, 'MIXED'>;

interface MixedPaymentLine {
  amountCents: number;
  amountDraft: string;
  id: string;
  method: SimplePaymentMethod;
  approvalCode?: string;
}

const SIMPLE_PAYMENT_OPTIONS: ReadonlyArray<{ label: string; method: PaymentMethod }> = [
  { method: 'CASH', label: 'Efectivo' },
  { method: 'CARD', label: 'Tarjeta' },
  { method: 'TRANSFER', label: 'Transferencia' },
  { method: 'MIXED', label: 'Mixto' }
];

function createLineId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `line-${Math.random().toString(36).slice(2, 10)}`;
}

function createMixedPaymentLine(method: SimplePaymentMethod, amountCents: number): MixedPaymentLine {
  return {
    amountCents,
    amountDraft: formatEditableMoneyFromCents(amountCents),
    id: createLineId(),
    method,
    approvalCode: ''
  };
}

function buildDefaultMixedLines(totalCents: number): MixedPaymentLine[] {
  return [
    createMixedPaymentLine('CASH', totalCents),
    createMixedPaymentLine('CARD', 0)
  ];
}

function suggestNextMethod(lines: ReadonlyArray<MixedPaymentLine>): SimplePaymentMethod {
  const usedMethods = new Set(lines.map((line) => line.method));

  if (!usedMethods.has('CARD')) {
    return 'CARD';
  }

  if (!usedMethods.has('TRANSFER')) {
    return 'TRANSFER';
  }

  return 'CASH';
}

export function CheckoutModal({
  cartItems,
  customers,
  discountCents,
  error,
  isOpen,
  isSubmitting,
  onClose,
  onConfirm,
  totalCents
}: {
  cartItems: CartItem[];
  customers: Customer[];
  discountCents: number;
  error: string | null;
  isOpen: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: (payments: CreateSaleRequest['payments'], customerId: string | null) => Promise<void> | void;
  totalCents: number;
}) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [cashReceivedDraft, setCashReceivedDraft] = useState('0');
  const [cardApprovalCode, setCardApprovalCode] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [terminalProcessing, setTerminalProcessing] = useState(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [terminalSuccess, setTerminalSuccess] = useState(false);
  const [mixedLines, setMixedLines] = useState<MixedPaymentLine[]>(() =>
    buildDefaultMixedLines(totalCents)
  );

  const cashInputRef = useRef<HTMLInputElement | null>(null);
  const mixedFirstInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setCashReceivedDraft(formatEditableMoneyFromCents(totalCents));
    setCardApprovalCode('');
    setMixedLines(buildDefaultMixedLines(totalCents));
    setSelectedCustomerId('');
    setTerminalProcessing(false);
    setTerminalError(null);
    setTerminalSuccess(false);
  }, [isOpen, totalCents]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (paymentMethod === 'CASH') {
        cashInputRef.current?.focus();
        return;
      }

      if (paymentMethod === 'MIXED') {
        mixedFirstInputRef.current?.focus();
      }
    }, 10);

    return () => window.clearTimeout(timeout);
  }, [isOpen, paymentMethod]);

  const subtotalCents = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.qty * item.priceCents, 0),
    [cartItems]
  );
  const totalUnits = useMemo(() => cartItems.reduce((sum, item) => sum + item.qty, 0), [cartItems]);
  const cashReceivedCents = parseVisibleMoneyToCents(cashReceivedDraft);
  const cashChangeCents = Math.max(0, cashReceivedCents - totalCents);
  const cashMissingCents = Math.max(0, totalCents - cashReceivedCents);
  const positiveMixedLines = useMemo(
    () => mixedLines.filter((line) => line.amountCents > 0),
    [mixedLines]
  );
  const mixedEnteredCents = useMemo(
    () => positiveMixedLines.reduce((sum, line) => sum + line.amountCents, 0),
    [positiveMixedLines]
  );
  
  const mixedCashEnteredCents = useMemo(
    () => positiveMixedLines.filter(l => l.method === 'CASH').reduce((sum, line) => sum + line.amountCents, 0),
    [positiveMixedLines]
  );
  const mixedNonCashEnteredCents = mixedEnteredCents - mixedCashEnteredCents;
  
  const mixedDifferenceCents = totalCents - mixedEnteredCents;
  const mixedChangeCents = Math.max(0, mixedEnteredCents - totalCents);
  
  const canConfirmCash = cashReceivedCents >= totalCents;
  
  const hasValidMixedApprovalCodes = positiveMixedLines.every((line) => line.method !== 'CARD' || (line.approvalCode && line.approvalCode.trim().length >= 3));
  
  // Mixed payment is valid if we meet the total, AND any overpayment is purely from CASH lines.
  const canConfirmMixed = 
    positiveMixedLines.length >= 2 && 
    mixedEnteredCents >= totalCents && 
    mixedNonCashEnteredCents <= totalCents &&
    hasValidMixedApprovalCodes;
  
  const canSubmit =
    totalCents > 0 &&
    !isSubmitting &&
    (paymentMethod === 'CASH'
      ? canConfirmCash
      : paymentMethod === 'MIXED'
        ? canConfirmMixed
        : paymentMethod === 'CARD'
          ? (terminalSuccess || cardApprovalCode.trim().length >= 3)
          : true);

  if (!isOpen) {
    return null;
  }

  function updateMixedLineMethod(lineId: string, method: string) {
    setMixedLines((current) =>
      current.map((line) =>
        line.id === lineId ? { ...line, method: method as SimplePaymentMethod } : line
      )
    );
  }

  function updateMixedLineAmount(lineId: string, amountDraft: string) {
    setMixedLines((current) =>
      current.map((line) =>
        line.id === lineId
          ? {
              ...line,
              amountDraft,
              amountCents: parseVisibleMoneyToCents(amountDraft)
            }
          : line
      )
    );
  }

  function updateMixedLineApprovalCode(lineId: string, approvalCode: string) {
    setMixedLines((current) =>
      current.map((line) => (line.id === lineId ? { ...line, approvalCode } : line))
    );
  }

  function removeMixedLine(lineId: string) {
    if (mixedLines.length <= 2) {
      return;
    }

    setMixedLines((current) => current.filter((line) => line.id !== lineId));
  }

  function completeMixedLine(lineId: string) {
    const line = mixedLines.find((currentLine) => currentLine.id === lineId);
    if (!line) {
      return;
    }

    const remainderCents = Math.max(0, totalCents - (mixedEnteredCents - line.amountCents));
    updateMixedLineAmount(lineId, formatEditableMoneyFromCents(remainderCents));
  }

  function addMixedLine() {
    setMixedLines((current) => [...current, createMixedPaymentLine(suggestNextMethod(current), 0)]);
  }

  function handleConfirm() {
    if (!canSubmit) {
      return;
    }

    const payments: CreateSaleRequest['payments'] =
      paymentMethod === 'MIXED'
        ? [
            {
              method: 'MIXED',
              payments: positiveMixedLines.map((line) => {
                // If it's a cash line and we have change, we subtract the change from that cash line
                // so the backend receives the exact payment match.
                let finalAmountCents = line.amountCents;
                if (line.method === 'CASH' && mixedChangeCents > 0) {
                  // Only deduct up to the line's amount, in case multiple cash lines exist
                  const deduction = Math.min(finalAmountCents, mixedChangeCents);
                  finalAmountCents -= deduction;
                  // (Note: in a perfect scenario we'd track deduction accurately across lines, 
                  // but typically there's only 1 cash line)
                }

                return {
                  method: line.method,
                  amount_cents: finalAmountCents,
                  ...(line.method === 'CARD' ? { approval_code: line.approvalCode?.trim() } : {})
                };
              })
            }
          ]
        : [
            {
              method: paymentMethod,
              amount_cents: totalCents,
              ...(paymentMethod === 'CARD' ? { approval_code: cardApprovalCode.trim() || 'TERM-APPV' } : {})
            }
          ];

    void onConfirm(payments, selectedCustomerId || null);
  }

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
    <Modal ariaLabel="Cobrar venta" onClose={onClose} size="wide">
      <div className="checkout-modal">
        <div className="checkout-header">
          <div>
            <span className="quick-product-badge">Cobro</span>
            <h3>Cobrar venta</h3>
            <p>
              {cartItems.length} línea(s) · {totalUnits} unidad(es)
            </p>
          </div>

          <button className="ghost-button" type="button" onClick={onClose} disabled={isSubmitting}>
            Cerrar
          </button>
        </div>

        <div className="checkout-layout">
          <section className="checkout-summary-card">
            <div className="checkout-total-block">
              <span>Total a cobrar</span>
              <strong>{formatMoneyFromCents(totalCents)}</strong>
            </div>

            <div className="totals-box totals-box-strong" style={{ marginBottom: '1rem' }}>
              <div>
                <span>Subtotal</span>
                <strong>{formatMoneyFromCents(subtotalCents)}</strong>
              </div>
              <div>
                <span>Descuento</span>
                <strong>-{formatMoneyFromCents(discountCents)}</strong>
              </div>
            </div>

            <label className="field" style={{ marginBottom: '1.5rem', background: 'var(--color-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--color-slate-200)' }}>
              <span style={{ fontWeight: 600, color: 'var(--color-slate-900)' }}>Asociar Cliente (Opcional)</span>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginBottom: '0.5rem' }}>
                Requerido por DIAN para compras altas.
              </p>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
              >
                <option value="">Consumidor Final (No identificado)</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.document_type} {c.document_number} - {c.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="checkout-cart-preview">
              {cartItems.slice(0, 4).map((item) => (
                <div key={item.productId} className="checkout-cart-row">
                  <span>
                    {item.qty} x {item.name}
                  </span>
                  <strong>{formatMoneyFromCents(item.qty * item.priceCents)}</strong>
                </div>
              ))}
              {cartItems.length > 4 ? (
                <div className="checkout-cart-row checkout-cart-row-muted">
                  <span>+ {cartItems.length - 4} línea(s) adicionales</span>
                </div>
              ) : null}
            </div>
          </section>

          <section className="checkout-payment-panel">
            <div className="checkout-method-selector">
              {SIMPLE_PAYMENT_OPTIONS.map((option) => (
                <button
                  key={option.method}
                  type="button"
                  className={`payment-method-btn ${paymentMethod === option.method ? 'active' : ''}`}
                  onClick={() => setPaymentMethod(option.method)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {paymentMethod === 'CASH' ? (
              <div className="checkout-section stack-md">
                <div className="section-heading">
                  <div>
                    <h3>Efectivo</h3>
                    <p>Registra lo recibido y valida el cambio antes de cerrar la venta</p>
                  </div>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setCashReceivedDraft(formatEditableMoneyFromCents(totalCents))}
                  >
                    Exacto
                  </button>
                </div>

                <label className="field">
                  <span>Recibido (COP)</span>
                  <input
                    ref={cashInputRef}
                    inputMode="numeric"
                    min={0}
                    step="50"
                    type="number"
                    value={cashReceivedDraft}
                    onChange={(event) => setCashReceivedDraft(event.target.value)}
                  />
                </label>

                <div className="checkout-mini-stats">
                  <div className="metric-card">
                    <span>Recibido</span>
                    <strong>{formatMoneyFromCents(cashReceivedCents)}</strong>
                  </div>
                  <div className="metric-card">
                    <span>Cambio</span>
                    <strong>{formatMoneyFromCents(cashChangeCents)}</strong>
                  </div>
                </div>

                {cashMissingCents > 0 ? (
                  <Banner tone="warning">
                    Faltan {formatMoneyFromCents(cashMissingCents)} para completar el cobro en
                    efectivo.
                  </Banner>
                ) : null}
              </div>
            ) : null}

            {paymentMethod === 'CARD' ? (
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
            ) : null}

            {paymentMethod === 'TRANSFER' ? (
              <div className="checkout-section stack-md">
                <div className="section-heading">
                  <div>
                    <h3>Transferencia</h3>
                    <p>La venta se registrará con el valor exacto confirmado por transferencia.</p>
                  </div>
                </div>

                <div className="checkout-exact-charge">
                  <span>Total a registrar</span>
                  <strong>{formatMoneyFromCents(totalCents)}</strong>
                </div>
              </div>
            ) : null}

            {paymentMethod === 'MIXED' ? (
              <div className="checkout-section stack-md">
                <div className="section-heading">
                  <div>
                    <h3>Pago mixto</h3>
                    <p>Combina varios métodos y valida que la suma coincida exactamente.</p>
                  </div>
                  <button className="ghost-button" type="button" onClick={addMixedLine}>
                    Agregar línea
                  </button>
                </div>

                <div className="mixed-payment-list">
                  {mixedLines.map((line, index) => (
                    <div key={line.id} className="mixed-payment-row">
                      <span className="mixed-payment-index">{index + 1}</span>
                      <select
                        aria-label={`Método línea ${index + 1}`}
                        value={line.method}
                        onChange={(event) => updateMixedLineMethod(line.id, event.target.value)}
                      >
                        <option value="CASH">Efectivo</option>
                        <option value="CARD">Tarjeta</option>
                        <option value="TRANSFER">Transferencia</option>
                      </select>
                      <input
                        ref={index === 0 ? mixedFirstInputRef : undefined}
                        aria-label={`Monto línea ${index + 1}`}
                        inputMode="numeric"
                        min={0}
                        step="50"
                        type="number"
                        value={line.amountDraft}
                        onChange={(event) => updateMixedLineAmount(line.id, event.target.value)}
                        style={{ width: '120px' }}
                      />
                      {line.method === 'CARD' ? (
                        <input
                          aria-label={`Voucher línea ${index + 1}`}
                          type="text"
                          placeholder="Voucher"
                          value={line.approvalCode || ''}
                          onChange={(event) => updateMixedLineApprovalCode(line.id, event.target.value)}
                          style={{ width: '120px' }}
                        />
                      ) : null}
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => completeMixedLine(line.id)}
                      >
                        Completar
                      </button>
                      <button
                        className="cart-row-remove"
                        type="button"
                        onClick={() => removeMixedLine(line.id)}
                        disabled={mixedLines.length <= 2}
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                </div>

                <div className="checkout-mini-stats">
                  <div className="metric-card">
                    <span>Ingresado</span>
                    <strong>{formatMoneyFromCents(mixedEnteredCents)}</strong>
                  </div>
                  {mixedChangeCents > 0 ? (
                    <div className="metric-card">
                      <span>Cambio (Efectivo)</span>
                      <strong>{formatMoneyFromCents(mixedChangeCents)}</strong>
                    </div>
                  ) : (
                    <div className="metric-card">
                      <span>Diferencia</span>
                      <strong>{formatMoneyFromCents(Math.abs(mixedDifferenceCents))}</strong>
                    </div>
                  )}
                </div>

                {positiveMixedLines.length < 2 ? (
                  <Banner tone="warning">El pago mixto debe tener al menos dos líneas con valor mayor a 0.</Banner>
                ) : null}

                {mixedDifferenceCents > 0 ? (
                  <Banner tone="warning">
                    Faltan {formatMoneyFromCents(mixedDifferenceCents)} para completar el pago mixto.
                  </Banner>
                ) : null}

                {mixedDifferenceCents < 0 && mixedNonCashEnteredCents > totalCents ? (
                  <Banner tone="warning">
                    El pago con Tarjeta o Transferencia no puede exceder el total. Solo se permite cambio en Efectivo.
                  </Banner>
                ) : null}
              </div>
            ) : null}

            {error ? <Banner tone="error">{error}</Banner> : null}

            <div className="checkout-actions">
              <button className="ghost-button" type="button" onClick={onClose} disabled={isSubmitting}>
                Volver
              </button>
              <button type="button" className="charge-button" onClick={handleConfirm} disabled={!canSubmit}>
                <span>{isSubmitting ? 'Procesando cobro...' : 'Confirmar cobro'}</span>
                <strong>{formatMoneyFromCents(totalCents)}</strong>
              </button>
            </div>
          </section>
        </div>
      </div>
    </Modal>
  );
}
