import React, { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { WaiterSelector } from '../../sales/components/WaiterSelector';
import { GuestsInput } from '../../sales/components/GuestsInput';
import { useModules } from '../../modules/FeatureModuleProvider';

interface OpenTableModalProps {
  isOpen: boolean;
  tableName: string;
  branchId: string;
  onClose: () => void;
  onConfirm: (waiterId: string | null, guestsCount: number) => void;
}

export function OpenTableModal({ isOpen, tableName, branchId, onClose, onConfirm }: OpenTableModalProps) {
  // Los módulos se leen de la sesión, no del contexto guardado en localStorage: es la
  // fuente autoritativa y no se queda vieja cuando la plataforma cambia un flag.
  const { hasModule } = useModules();
  const requiresWaiter = hasModule('waiters');
  const showGuests = hasModule('guests_count');
  const [waiterId, setWaiterId] = useState<string | null>(null);
  const [guestsCount, setGuestsCount] = useState<number>(1);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 text-gray-800">
        <h3 className="text-xl font-bold mb-4">Abrir Mesa: {tableName}</h3>
        
        <div className="flex flex-col gap-4 mb-6">
          {/* Sin el módulo de meseros no se pide ninguno. Antes el selector se mostraba
              siempre y el botón exigía elegir uno, de modo que un comercio con mesas pero
              sin meseros no podía abrir ninguna mesa. */}
          {requiresWaiter && (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold">Selecciona un Mesero (Requerido)</label>
              <WaiterSelector branchId={branchId} value={waiterId} onChange={setWaiterId} variant="light" />
            </div>
          )}

          {showGuests && (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold">Número de personas</label>
              <GuestsInput value={guestsCount} onChange={setGuestsCount} variant="light" />
            </div>
          )}

          {!requiresWaiter && !showGuests && (
            <p className="text-sm text-gray-500">Se abrirá la mesa y podrás empezar a tomar el pedido.</p>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button 
            onClick={() => onConfirm(waiterId, guestsCount)}
            disabled={(requiresWaiter && !waiterId) || guestsCount < 1}
          >
            Abrir y Atender
          </Button>
        </div>
      </div>
    </div>
  );
}
