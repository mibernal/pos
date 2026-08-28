import { useMemo, useState, useEffect, useCallback } from 'react';
import { Banner, Modal } from '../../../components/ui';
import { formatMoneyFromCents } from '../../../lib/format';
import type { Customer, CreateSaleRequest } from '../../../lib/api';
import type { CartItem, PaymentMethod } from '../../../types';

import { useCheckoutPayment } from './checkout/useCheckoutPayment';
import { CashPaymentPanel } from './checkout/CashPaymentPanel';
import { TerminalPaymentPanel } from './checkout/TerminalPaymentPanel';
import { MixedPaymentPanel } from './checkout/MixedPaymentPanel';
import { TipSelector } from './checkout/TipSelector';
import { ModuleGuard } from '../../modules';

const SIMPLE_PAYMENT_OPTIONS: ReadonlyArray<{ label: string; method: PaymentMethod; shortcut: string }> = [
  { method: 'CASH', label: 'Efectivo', shortcut: 'F1' },
  { method: 'CARD', label: 'Tarjeta', shortcut: 'F2' },
  { method: 'TRANSFER', label: 'Transferencia', shortcut: 'F3' },
  { method: 'MIXED', label: 'Mixto', shortcut: 'F4' }
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
  totalCents,
  initialSplitParts
  // TODO(fase-1): initialSplitAmounts llega pero no se usa — la división por
  // montos no precarga el cobro.
}: {
  cartItems: CartItem[];
  customers: Customer[];
  discountCents: number;
  error: string | null;
  isOpen: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: (payments: CreateSaleRequest['payments'], customerId: string | null, tipCents: number) => Promise<void> | void;
  totalCents: number;
  initialSplitParts?: number;
  initialSplitAmounts?: number[];
}) {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerSearchText, setCustomerSearchText] = useState<string>('');
  const [tipCents, setTipCents] = useState<number>(0);

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
    mixedCashEnteredCents, // eslint-disable-line @typescript-eslint/no-unused-vars
    mixedNonCashEnteredCents,
    mixedDifferenceCents,
    mixedChangeCents,
    mixedFirstInputRef,
    
    canSubmit
  } = useCheckoutPayment(totalCents + tipCents, isOpen, initialSplitParts);

  const subtotalCents = useMemo(
    () => cartItems.reduce((sum, item) => {
      const modifierSum = item.modifiers?.reduce((mSum, m) => mSum + m.priceCents, 0) || 0;
      return sum + item.qty * (item.priceCents + modifierSum);
    }, 0),
    [cartItems]
  );
  const totalUnits = useMemo(() => cartItems.reduce((sum, item) => sum + item.qty, 0), [cartItems]);

  const handleConfirm = useCallback(() => {
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
              amount_cents: totalCents + tipCents,
              ...(paymentMethod === 'CARD' ? { approval_code: cardApprovalCode.trim() || 'TERM-APPV' } : {})
            }
          ];

    void onConfirm(payments, selectedCustomerId || null, tipCents);
  }, [
    canSubmit,
    paymentMethod,
    positiveMixedLines,
    mixedChangeCents,
    totalCents,
    tipCents,
    cardApprovalCode,
    selectedCustomerId,
    onConfirm
  ]);

  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'F1') {
        event.preventDefault();
        setPaymentMethod('CASH');
      } else if (event.key === 'F2') {
        event.preventDefault();
        setPaymentMethod('CARD');
      } else if (event.key === 'F3') {
        event.preventDefault();
        setPaymentMethod('TRANSFER');
      } else if (event.key === 'F4') {
        event.preventDefault();
        setPaymentMethod('MIXED');
      } else if (event.key === 'Enter') {
        // Only trigger confirm if not inside an input (unless it's the cash input, where enter is very useful)
        const target = event.target as HTMLElement | null;
        const isSelect = target?.tagName === 'SELECT';
        const isTextArea = target?.tagName === 'TEXTAREA';
        if (!isSelect && !isTextArea && canSubmit && !isSubmitting) {
          event.preventDefault();
          handleConfirm();
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, canSubmit, isSubmitting, setPaymentMethod, handleConfirm]);

  if (!isOpen) {
    return null;
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
              <strong>{formatMoneyFromCents(totalCents + tipCents)}</strong>
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
              {tipCents > 0 && (
                <div>
                  <span>Propina</span>
                  <strong>{formatMoneyFromCents(tipCents)}</strong>
                </div>
              )}
            </div>

            <ModuleGuard module="tips">
              <TipSelector 
                subtotalCents={subtotalCents}
                tipCents={tipCents}
                onTipChange={setTipCents}
              />
            </ModuleGuard>

            <label className="field" style={{ marginBottom: '1.5rem', background: 'var(--color-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--color-slate-200)' }}>
              <span style={{ fontWeight: 600, color: 'var(--color-slate-900)' }}>Asociar Cliente (Opcional)</span>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginBottom: '0.5rem' }}>
                Requerido por DIAN para compras altas.
              </p>
              <input
                list="customer-list"
                placeholder="Consumidor Final (Buscar por cédula o nombre...)"
                value={customerSearchText}
                onChange={(e) => {
                  setCustomerSearchText(e.target.value);
                  const found = customers.find(c => `${c.document_type} ${c.document_number} - ${c.name}` === e.target.value);
                  if (found) {
                    setSelectedCustomerId(found.id);
                  } else {
                    setSelectedCustomerId('');
                  }
                }}
              />
              <datalist id="customer-list">
                {customers.map((c) => (
                  <option key={c.id} value={`${c.document_type} ${c.document_number} - ${c.name}`} />
                ))}
              </datalist>
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
                  {option.shortcut && <kbd style={{ marginRight: '0.5rem', background: 'rgba(0,0,0,0.1)', padding: '0.1rem 0.3rem', borderRadius: '4px', fontSize: '0.7em' }}>{option.shortcut}</kbd>}
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
              <button type="button" className="charge-button" onClick={handleConfirm} disabled={!canSubmit || isSubmitting}>
                <span>{isSubmitting ? 'Procesando cobro...' : '[Enter] Confirmar cobro'}</span>
                <strong>{formatMoneyFromCents(totalCents)}</strong>
              </button>
            </div>
          </section>
        </div>
      </div>
    </Modal>
  );
}
