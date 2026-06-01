import { useMemo, useState } from 'react';
import { Banner, Modal } from '../../../components/ui';
import { formatMoneyFromCents } from '../../../lib/format';
import type { Customer, CreateSaleRequest } from '../../../lib/api';
import type { CartItem, PaymentMethod } from '../../../types';

import { useCheckoutPayment } from './checkout/useCheckoutPayment';
import { CashPaymentPanel } from './checkout/CashPaymentPanel';
import { TerminalPaymentPanel } from './checkout/TerminalPaymentPanel';
import { MixedPaymentPanel } from './checkout/MixedPaymentPanel';

const SIMPLE_PAYMENT_OPTIONS: ReadonlyArray<{ label: string; method: PaymentMethod }> = [
  { method: 'CASH', label: 'Efectivo' },
  { method: 'CARD', label: 'Tarjeta' },
  { method: 'TRANSFER', label: 'Transferencia' },
  { method: 'MIXED', label: 'Mixto' }
];

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
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');

  const {
    paymentMethod,
    setPaymentMethod,
    
    cashReceivedDraft,
    setCashReceivedDraft,
    cashReceivedCents,
    cashChangeCents,
    cashMissingCents,
    cashInputRef,
    
    cardApprovalCode,
    setCardApprovalCode,
    terminalProcessing,
    setTerminalProcessing,
    terminalError,
    setTerminalError,
    terminalSuccess,
    setTerminalSuccess,
    
    mixedLines,
    setMixedLines,
    positiveMixedLines,
    mixedEnteredCents,
    mixedCashEnteredCents,
    mixedNonCashEnteredCents,
    mixedDifferenceCents,
    mixedChangeCents,
    mixedFirstInputRef,
    
    canSubmit
  } = useCheckoutPayment(totalCents, isOpen);

  const subtotalCents = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.qty * item.priceCents, 0),
    [cartItems]
  );
  const totalUnits = useMemo(() => cartItems.reduce((sum, item) => sum + item.qty, 0), [cartItems]);

  if (!isOpen) {
    return null;
  }

  function handleConfirm() {
    if (!canSubmit) return;

    const payments: CreateSaleRequest['payments'] =
      paymentMethod === 'MIXED'
        ? [
            {
              method: 'MIXED',
              payments: positiveMixedLines.map((line) => {
                let finalAmountCents = line.amountCents;
                if (line.method === 'CASH' && mixedChangeCents > 0) {
                  const deduction = Math.min(finalAmountCents, mixedChangeCents);
                  finalAmountCents -= deduction;
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
              <CashPaymentPanel 
                totalCents={totalCents}
                cashReceivedDraft={cashReceivedDraft}
                setCashReceivedDraft={setCashReceivedDraft}
                cashReceivedCents={cashReceivedCents}
                cashChangeCents={cashChangeCents}
                cashMissingCents={cashMissingCents}
                cashInputRef={cashInputRef}
              />
            ) : null}

            {paymentMethod === 'CARD' ? (
              <TerminalPaymentPanel 
                totalCents={totalCents}
                cardApprovalCode={cardApprovalCode}
                setCardApprovalCode={setCardApprovalCode}
                terminalProcessing={terminalProcessing}
                setTerminalProcessing={setTerminalProcessing}
                terminalError={terminalError}
                setTerminalError={setTerminalError}
                terminalSuccess={terminalSuccess}
                setTerminalSuccess={setTerminalSuccess}
              />
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
              <MixedPaymentPanel 
                totalCents={totalCents}
                mixedLines={mixedLines}
                setMixedLines={setMixedLines}
                positiveMixedLines={positiveMixedLines}
                mixedEnteredCents={mixedEnteredCents}
                mixedNonCashEnteredCents={mixedNonCashEnteredCents}
                mixedDifferenceCents={mixedDifferenceCents}
                mixedChangeCents={mixedChangeCents}
                mixedFirstInputRef={mixedFirstInputRef}
              />
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
