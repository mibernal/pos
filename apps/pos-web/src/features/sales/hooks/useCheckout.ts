import { useCallback, useState } from 'react';
import type { LastPrintedSaleSnapshot, CartItem } from '../../../types';
import type { CreateSaleRequest } from '../../../lib/api';
import { addPendingSale } from '../../../lib/offline-queue';
import { getCheckoutErrorMessage, shouldQueueSaleAsPending } from '../utils';
import { useApi } from '../../auth';

export interface UseCheckoutOptions {
  branchId: string;
  cashSessionId: string;
  onSaleSuccess: () => void;
  onSaleQueued: () => Promise<void> | void;
}

export function useCheckout({ branchId,
  cashSessionId,
  onSaleSuccess,
  onSaleQueued
}: UseCheckoutOptions) {
  const api = useApi();
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [saleMessage, setSaleMessage] = useState<string | null>(null);
  const [lastPrintedSaleSnapshot, setLastPrintedSaleSnapshot] = useState<LastPrintedSaleSnapshot | null>(null);

  const processSale = useCallback(async (
    cartItems: CartItem[],
    discountCents: number,
    tipCents: number,
    subtotalCents: number,
    totalCents: number,
    payments: CreateSaleRequest['payments'],
    customerId: string | null,
    tableOrderId?: string | null
  ) => {
    setCheckoutLoading(true);
    setSaleError(null);
    setSaleMessage(null);

    const ticketItemsSnapshot = cartItems.map((item) => ({
      name: item.name,
      qty: item.qty,
      priceCents: item.priceCents,
      lineTotalCents: item.priceCents * item.qty,
      notes: item.notes
    }));

    const salePayload: CreateSaleRequest = {
      client_uuid: crypto.randomUUID(),
      customer_id: customerId ?? undefined,
      branch_id: branchId,
      cash_session_id: cashSessionId,
      table_order_id: tableOrderId ?? undefined,
      discount_cents: discountCents,
      tip_cents: tipCents,
      items: cartItems.map((item) => ({
        product_id: item.productId,
        variant_id: item.variantId ?? undefined,
        qty: item.qty,
        price_cents: item.priceCents,
        notes: item.notes,
        modifiers: item.modifiers?.map(m => m.id)
      })),
      payments,
      snapshot: {
        subtotal_cents: subtotalCents,
        discount_cents: discountCents,
        tip_cents: tipCents,
        tax_total_cents: 0, // Frontend does not calculate taxes yet
        // total_cents must include the tip so the backend drift check compares apples to apples.
        // Backend computes: totalCents = subtotal - discount + tip, so the snapshot must match.
        total_cents: totalCents + tipCents
      }
    };

    let saleSucceeded = false;
    let offlineQueued = false;

    try {
      const result = await api.createSale(salePayload);

      setIsCheckoutModalOpen(false);
      setLastPrintedSaleSnapshot({
        sale: result.sale,
        items: ticketItemsSnapshot
      });
      setSaleMessage(
        `Venta #${result.sale.sale_number} registrada. Estado DIAN: ${result.sale.dian_status ?? 'PENDING'}`
      );
      saleSucceeded = true;
    } catch (checkoutError) {
      if (shouldQueueSaleAsPending(checkoutError)) {
        try {
          await addPendingSale(salePayload);
          offlineQueued = true;
          setIsCheckoutModalOpen(false);
          setLastPrintedSaleSnapshot(null);
          setSaleMessage(
            'Venta guardada como pendiente por falta de conexión. Sincroniza cuando vuelva internet.'
          );
        } catch (queueError) { // eslint-disable-line @typescript-eslint/no-unused-vars
          setSaleError('Error al guardar la venta como pendiente localmente. Por favor, revisa el almacenamiento.');
        }
      } else {
        setSaleError(getCheckoutErrorMessage(checkoutError));
      }
    } finally {
      setCheckoutLoading(false);
    }

    if (saleSucceeded) {
      onSaleSuccess();
    } else if (offlineQueued) {
      await onSaleQueued();
      onSaleSuccess();
    }
  }, [api, branchId, cashSessionId, onSaleQueued, onSaleSuccess]);

  return {
    isCheckoutModalOpen,
    setIsCheckoutModalOpen,
    checkoutLoading,
    saleError,
    setSaleError,
    saleMessage,
    setSaleMessage,
    lastPrintedSaleSnapshot,
    processSale
  };
}
