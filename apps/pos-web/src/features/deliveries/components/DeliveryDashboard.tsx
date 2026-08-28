import React from 'react';
import { useGetActiveDeliveries, useUpdateDeliveryStatus } from '../api/deliveries.api';
import { usePosStore } from '../../../hooks/usePosStore';
import { DeliveryStatus, DeliveryWithDetails } from '@pos-dian/shared';
import { Button } from '../../../components/ui/Button';
import { useDeliveriesStore } from '../store/useDeliveriesStore';
import { useSession } from '../../auth';

const formatCurrency = (cents: number) => {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0
  }).format(cents / 100);
};

export const DeliveryDashboard: React.FC = () => {
  const posContext = usePosStore(state => state.posContext);
  const { data: deliveries, isLoading } = useGetActiveDeliveries(posContext?.branchId);
  const { openCreateDeliveryModal } = useDeliveriesStore();
  
  if (isLoading) return <div className="p-8 flex items-center justify-center h-full">Cargando domicilios...</div>;

  const pending = deliveries?.filter(d => d.status === 'PENDING') || [];
  const preparing = deliveries?.filter(d => d.status === 'PREPARING') || [];
  const onTheWay = deliveries?.filter(d => d.status === 'ON_THE_WAY') || [];

  return (
    <div className="flex flex-col h-full bg-background p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Domicilios Activos</h1>
          <p className="text-muted-foreground">
            {deliveries?.length || 0} domicilios en curso
          </p>
        </div>
        <Button onClick={openCreateDeliveryModal}>
          + Nuevo Domicilio
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-full overflow-hidden">
        <Column title="Pendiente" status="PENDING" items={pending} />
        <Column title="En Preparación" status="PREPARING" items={preparing} />
        <Column title="En Camino" status="ON_THE_WAY" items={onTheWay} />
      </div>
    </div>
  );
};

const Column: React.FC<{ title: string; status: DeliveryStatus; items: DeliveryWithDetails[] }> = ({ title, items }) => {
  return (
    <div className="flex flex-col bg-muted/50 rounded-lg p-4 h-full overflow-hidden">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold">{title}</h3>
        <span className="bg-background text-xs font-medium px-2 py-1 rounded-full border shadow-sm">
          {items.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 pr-2 pb-2">
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">No hay domicilios</div>
        ) : (
          items.map(item => <DeliveryCard key={item.id} delivery={item} />)
        )}
      </div>
    </div>
  );
};

const DeliveryCard: React.FC<{ delivery: DeliveryWithDetails }> = ({ delivery }) => {
  const posContext = usePosStore(state => state.posContext);
  const { api } = useSession();
  const { mutateAsync: updateStatus, isPending } = useUpdateDeliveryStatus();

  const handleNextStatus = async () => {
    if (!posContext?.branchId) return;
    
    let nextStatus: DeliveryStatus | null = null;
    let saleId: string | undefined = undefined;

    if (delivery.status === 'PENDING') nextStatus = 'PREPARING';
    else if (delivery.status === 'PREPARING') nextStatus = 'ON_THE_WAY';
    else if (delivery.status === 'ON_THE_WAY') {
      nextStatus = 'DELIVERED';
      
      // Facturación: Create Sale
      if (posContext.cashSessionId) {
        try {
          const salePayload = {
            client_uuid: crypto.randomUUID(),
            branch_id: posContext.branchId,
            cash_session_id: posContext.cashSessionId,
            discount_cents: 0,
            tip_cents: 0,
            items: delivery.items.map((item) => ({
              product_id: item.productId,
              qty: item.qty,
              price_cents: item.priceCents
            })),
            payments: [{
              amount_cents: delivery.totalCents,
              method: 'CASH' as const
            }],
            snapshot: {
              subtotal_cents: delivery.totalCents,
              discount_cents: 0,
              tax_total_cents: 0,
              total_cents: delivery.totalCents
            }
          };
          const result = await api.createSale(salePayload);
          saleId = result.sale.id;
        } catch (error) {
          console.error('Error creating sale for delivery:', error);
          alert('Error al facturar el domicilio. Por favor, revisa la conexión o la sesión de caja.');
          return;
        }
      } else {
        alert('Se requiere una sesión de caja abierta para facturar el domicilio.');
        return;
      }
    }

    if (nextStatus) {
      await updateStatus({
        branchId: posContext.branchId,
        id: delivery.id,
        payload: { status: nextStatus, saleId }
      });
    }
  };

  const handleCancel = async () => {
    if (!posContext?.branchId) return;
    if (confirm('¿Estás seguro de cancelar este domicilio?')) {
      await updateStatus({
        branchId: posContext.branchId,
        id: delivery.id,
        payload: { status: 'CANCELLED' }
      });
    }
  }

  const timeElapsed = Math.floor((Date.now() - new Date(delivery.createdAt).getTime()) / 60000);

  return (
    <div className="bg-card text-card-foreground rounded-lg border shadow-sm p-4 space-y-3">
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <p className="font-medium leading-none">{delivery.customerName}</p>
          <p className="text-sm text-muted-foreground">{delivery.customerPhone}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold">{formatCurrency(delivery.totalCents)}</p>
          <p className={`text-xs ${timeElapsed > 30 ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>
            {timeElapsed} min
          </p>
        </div>
      </div>
      
      <div className="text-sm bg-muted/50 p-2 rounded-md">
        <p className="font-medium">{delivery.deliveryAddress}</p>
        {delivery.deliveryNeighborhood && <p className="text-muted-foreground">{delivery.deliveryNeighborhood}</p>}
      </div>

      {delivery.items.length > 0 && (
        <div className="text-sm">
          <p className="text-muted-foreground mb-1">{delivery.items.length} items</p>
        </div>
      )}

      {delivery.deliveryNotes && (
        <div className="text-xs border-l-2 border-primary pl-2 italic">
          {delivery.deliveryNotes}
        </div>
      )}

      <div className="pt-2 flex justify-between gap-2 border-t mt-2">
        <Button variant="ghost" size="sm" onClick={handleCancel} disabled={isPending} className="text-red-500 hover:text-red-600 hover:bg-red-50">
          Cancelar
        </Button>
        <Button size="sm" onClick={handleNextStatus} disabled={isPending}>
          {delivery.status === 'PENDING' && 'A Preparación'}
          {delivery.status === 'PREPARING' && 'Enviar'}
          {delivery.status === 'ON_THE_WAY' && 'Entregado'}
        </Button>
      </div>
    </div>
  );
};
