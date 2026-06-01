import React from 'react';
import { Banner } from '../../../../components/ui';
import { formatMoneyFromCents } from '../../../../lib/format';
import { formatEditableMoneyFromCents, parseVisibleMoneyToCents } from '../../utils';
import { suggestNextMethod, createMixedPaymentLine, type MixedPaymentLine, type SimplePaymentMethod } from './useCheckoutPayment';

export function MixedPaymentPanel({
  totalCents,
  mixedLines,
  setMixedLines,
  positiveMixedLines,
  mixedEnteredCents,
  mixedNonCashEnteredCents,
  mixedDifferenceCents,
  mixedChangeCents,
  mixedFirstInputRef
}: {
  totalCents: number;
  mixedLines: MixedPaymentLine[];
  setMixedLines: React.Dispatch<React.SetStateAction<MixedPaymentLine[]>>;
  positiveMixedLines: MixedPaymentLine[];
  mixedEnteredCents: number;
  mixedNonCashEnteredCents: number;
  mixedDifferenceCents: number;
  mixedChangeCents: number;
  mixedFirstInputRef: React.RefObject<HTMLInputElement>;
}) {
  
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
    if (mixedLines.length <= 2) return;
    setMixedLines((current) => current.filter((line) => line.id !== lineId));
  }

  function completeMixedLine(lineId: string) {
    const line = mixedLines.find((currentLine) => currentLine.id === lineId);
    if (!line) return;
    const remainderCents = Math.max(0, totalCents - (mixedEnteredCents - line.amountCents));
    updateMixedLineAmount(lineId, formatEditableMoneyFromCents(remainderCents));
  }

  function addMixedLine() {
    setMixedLines((current) => [...current, createMixedPaymentLine(suggestNextMethod(current), 0)]);
  }

  return (
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
  );
}
