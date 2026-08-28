import React, { useState } from 'react';
import { ArrowRight, Table as TableIcon } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { TableOrderItem, Table } from '@pos-dian/shared';
import { useGetRooms, useTransferTableOrder } from '../api/tables.api';
import { usePosStore } from '../../../hooks/usePosStore';

interface TransferTableModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceTable: Table;
  items: TableOrderItem[];
  onTransferComplete?: () => void;
}

export const TransferTableModal: React.FC<TransferTableModalProps> = ({ 
  isOpen, 
  onClose, 
  sourceTable, 
  items,
  onTransferComplete 
}) => {
  const posContext = usePosStore((state) => state.posContext);
  const currentBranchId = posContext?.branchId;
  const { data: rooms, isLoading: isLoadingRooms } = useGetRooms(currentBranchId);
  const { mutateAsync: transferTable, isPending } = useTransferTableOrder();

  const [destinationTableId, setDestinationTableId] = useState<string>('');
  const [transferMode, setTransferMode] = useState<'ALL' | 'PARTIAL'>('ALL');
  
  // State for partial transfer: map of itemId -> qty to transfer
  const [partialQty, setPartialQty] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  // Initialize partial qty when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setDestinationTableId('');
      setTransferMode('ALL');
      const initialQty: Record<string, number> = {};
      items.forEach(item => {
        initialQty[item.id] = 0;
      });
      setPartialQty(initialQty);
      setError(null);
    }
  }, [isOpen, items]);

  if (!isOpen) return null;

  const handleQtyChange = (itemId: string, increment: number, maxQty: number) => {
    setPartialQty(prev => {
      const current = prev[itemId] || 0;
      const next = Math.max(0, Math.min(maxQty, current + increment));
      return { ...prev, [itemId]: next };
    });
  };

  const handleConfirm = async () => {
    setError(null);
    if (!currentBranchId || !destinationTableId) {
      setError('Seleccione una mesa destino');
      return;
    }

    try {
      let payloadItems = undefined;

      if (transferMode === 'PARTIAL') {
        const itemsToMove = items
          .filter(i => (partialQty[i.id] || 0) > 0)
          .map(i => ({
            productId: i.productId,
            variantId: i.variantId,
            qty: partialQty[i.id] || 0
          }));
        
        if (itemsToMove.length === 0) {
          setError('No ha seleccionado productos para transferir');
          return;
        }
        payloadItems = itemsToMove;
      }

      await transferTable({
        branchId: currentBranchId,
        tableId: sourceTable.id,
        payload: {
          destinationTableId,
          items: payloadItems
        }
      });

      onTransferComplete?.();
      onClose();
    } catch {
      setError('Error al transferir la mesa');
    }
  };

  const hasItemsSelected = transferMode === 'ALL' || Object.values(partialQty).some(qty => (qty || 0) > 0);

  return (
    <Modal ariaLabel="Cambio de Mesa" onClose={onClose} size="wide">
      <div className="space-y-6">
        
        {/* Step 1: Select Destination */}
        <div>
          <h3 className="font-semibold text-gray-800 mb-3">1. Seleccionar Mesa Destino</h3>
          {isLoadingRooms ? (
            <div className="text-gray-500">Cargando mesas...</div>
          ) : (
            <div className="max-h-60 overflow-y-auto border rounded-xl p-3 bg-gray-50 space-y-4">
              {rooms?.map(room => (
                <div key={room.id}>
                  <h4 className="text-sm font-medium text-gray-500 mb-2 uppercase">{room.name}</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {room.tables.map(table => {
                      if (table.id === sourceTable.id) return null; // Can't transfer to itself
                      const isSelected = destinationTableId === table.id;
                      const isOccupied = table.status === 'OCCUPIED' || table.currentOrderId;
                      
                      return (
                        <button
                          key={table.id}
                          onClick={() => setDestinationTableId(table.id)}
                          className={`flex items-center gap-2 p-3 border rounded-lg text-left transition-all ${
                            isSelected 
                              ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-200' 
                              : isOccupied 
                                ? 'border-amber-300 bg-amber-50 hover:bg-amber-100' 
                                : 'border-gray-200 bg-white hover:bg-gray-50'
                          }`}
                        >
                          <TableIcon size={18} className={isSelected ? 'text-blue-500' : isOccupied ? 'text-amber-500' : 'text-gray-400'} />
                          <div className="flex-1 truncate font-medium">{table.name}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Step 2: Select Mode */}
        {destinationTableId && (
          <div>
            <h3 className="font-semibold text-gray-800 mb-3">2. Modalidad de Transferencia</h3>
            <div className="flex gap-4">
              <button
                onClick={() => setTransferMode('ALL')}
                className={`flex-1 p-4 border-2 rounded-xl text-center font-medium transition-all ${
                  transferMode === 'ALL' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Mesa Completa
              </button>
              <button
                onClick={() => setTransferMode('PARTIAL')}
                className={`flex-1 p-4 border-2 rounded-xl text-center font-medium transition-all ${
                  transferMode === 'PARTIAL' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Productos Específicos
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Specific Products */}
        {destinationTableId && transferMode === 'PARTIAL' && (
          <div>
            <h3 className="font-semibold text-gray-800 mb-3">3. Seleccionar Productos a Mover</h3>
            <div className="max-h-60 overflow-y-auto space-y-2 border rounded-xl divide-y">
              {items.map(item => (
                <div key={item.id} className="p-3 flex justify-between items-center bg-white hover:bg-gray-50">
                  <div className="flex-1">
                    <p className="font-medium text-gray-800 line-clamp-1">{item.productName || 'Producto'}</p>
                    <p className="text-xs text-gray-500">Disponible: {item.qty}</p>
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    <button 
                      onClick={() => handleQtyChange(item.id, -1, item.qty)}
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50"
                      disabled={!(partialQty[item.id] || 0)}
                    >
                      -
                    </button>
                    <span className="w-6 text-center font-semibold text-lg">{partialQty[item.id] || 0}</span>
                    <button 
                      onClick={() => handleQtyChange(item.id, 1, item.qty)}
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50"
                      disabled={(partialQty[item.id] || 0) >= item.qty}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        {error && <div className="text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">{error}</div>}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={!destinationTableId || !hasItemsSelected || isPending}
            className="flex items-center gap-2"
          >
            Confirmar Traslado
            <ArrowRight size={18} />
          </Button>
        </div>
      </div>
    </Modal>
  );
};
