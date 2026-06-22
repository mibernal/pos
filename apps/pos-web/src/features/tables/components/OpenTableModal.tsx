import React, { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { WaiterSelector } from '../../sales/components/WaiterSelector';
import { GuestsInput } from '../../sales/components/GuestsInput';

interface OpenTableModalProps {
  isOpen: boolean;
  tableName: string;
  branchId: string;
  onClose: () => void;
  onConfirm: (waiterId: string | null, guestsCount: number) => void;
}

export function OpenTableModal({ isOpen, tableName, branchId, onClose, onConfirm }: OpenTableModalProps) {
  const [waiterId, setWaiterId] = useState<string | null>(null);
  const [guestsCount, setGuestsCount] = useState<number>(1);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 text-gray-800">
        <h3 className="text-xl font-bold mb-4">Abrir Mesa: {tableName}</h3>
        
        <div className="flex flex-col gap-4 mb-6">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold">Selecciona un Mesero (Requerido)</label>
            <WaiterSelector branchId={branchId} value={waiterId} onChange={setWaiterId} variant="light" />
          </div>
          
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold">Número de personas</label>
            <GuestsInput value={guestsCount} onChange={setGuestsCount} variant="light" />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button 
            onClick={() => onConfirm(waiterId, guestsCount)}
            disabled={!waiterId || guestsCount < 1}
          >
            Abrir y Atender
          </Button>
        </div>
      </div>
    </div>
  );
}
