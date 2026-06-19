import React, { useState } from 'react';
import { CreateDeliverySchema } from '@pos-dian/shared';
import { useDeliveriesStore } from '../store/useDeliveriesStore';
import { useCreateDelivery } from '../api/deliveries.api';
import { usePosStore } from '../../../hooks/usePosStore';
import { useCartStore } from '../../sales/hooks/useCartStore';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';

export const CreateDeliveryModal: React.FC = () => {
  const posContext = usePosStore(state => state.posContext);
  const cartItems = useCartStore(state => state.cartItems);
  const resetCart = useCartStore(state => state.resetCart);
  const { isCreateDeliveryModalOpen, closeCreateDeliveryModal } = useDeliveriesStore();
  const { mutateAsync: createDelivery, isPending } = useCreateDelivery();

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryNeighborhood, setDeliveryNeighborhood] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!posContext?.branchId) return;

    if (cartItems.length === 0) {
      setError('El carrito está vacío. Agrega productos antes de crear un domicilio.');
      return;
    }

    const payload = {
      customerName,
      customerPhone,
      deliveryAddress,
      deliveryNeighborhood: deliveryNeighborhood || undefined,
      deliveryNotes: deliveryNotes || undefined,
      items: cartItems.map(i => ({
        productId: i.productId,
        variantId: i.variantId,
        qty: i.qty,
        priceCents: i.priceCents
      }))
    };

    const parseResult = CreateDeliverySchema.safeParse(payload);
    if (!parseResult.success) {
      setError(parseResult.error.issues[0]?.message || 'Datos inválidos');
      return;
    }

    try {
      setError(null);
      await createDelivery({ branchId: posContext.branchId, payload: parseResult.data });
      resetCart();
      closeModal();
    } catch (err) {
      console.error('Error creating delivery:', err);
      setError('Error al crear el domicilio');
    }
  };

  const closeModal = () => {
    setCustomerName('');
    setCustomerPhone('');
    setDeliveryAddress('');
    setDeliveryNeighborhood('');
    setDeliveryNotes('');
    setError(null);
    closeCreateDeliveryModal();
  };

  if (!isCreateDeliveryModalOpen) return null;

  return (
    <Modal ariaLabel="Nuevo Domicilio" onClose={closeModal}>
      <div className="sm:max-w-[500px]">
        <div>
          <h2 className="text-lg font-semibold">Nuevo Domicilio</h2>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nombre del Cliente *</label>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                placeholder="Ej. Juan Pérez"
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Teléfono *</label>
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                placeholder="Ej. 3001234567"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Dirección *</label>
            <input
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              placeholder="Ej. Calle 123 #45-67"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Barrio</label>
            <input
              value={deliveryNeighborhood}
              onChange={(e) => setDeliveryNeighborhood(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              placeholder="Opcional"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Observaciones / Notas</label>
            <textarea
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              placeholder="Ej. Timbre dañado, llamar al llegar..."
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 font-medium">{error}</p>
          )}

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={closeModal} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Guardando...' : `Confirmar Domicilio (${cartItems.length} items)`}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
};
