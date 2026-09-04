import React, { useState } from 'react';
import { useGetWaiters, useCreateWaiter, useUpdateWaiter } from './api/waiters.api';
import { WaiterModal } from './components/WaiterModal';
import { Button } from '../../components/ui/Button';
import type { Waiter } from '@pos-dian/shared';
import { usePosStore } from '../../hooks/usePosStore';
import { WaiterShiftsPanel } from './components/WaiterShiftsPanel';
import { ModuleGuard } from '../modules';

export function WaitersScreen() {
  const branchId = usePosStore((state) => state.posContext?.branchId);
  const cashSessionId = usePosStore((state) => state.posContext?.cashSessionId);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingWaiter, setEditingWaiter] = useState<Waiter | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: waiters, isLoading, error } = useGetWaiters(branchId ?? '');
  const { mutateAsync: createWaiter, isPending: isCreating } = useCreateWaiter();
  const { mutateAsync: updateWaiter, isPending: isUpdating } = useUpdateWaiter();

  const handleOpenCreate = () => {
    setEditingWaiter(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (waiter: Waiter) => {
    setEditingWaiter(waiter);
    setIsModalOpen(true);
  };

  const handleSave = async (data: { name: string; pin?: string | null; is_active: boolean }) => {
    try {
      setSaveError(null);
      if (editingWaiter) {
        await updateWaiter({ branchId: branchId ?? '', id: editingWaiter.id, payload: data });
      } else {
        await createWaiter({ branchId: branchId ?? '', payload: data });
      }
      setIsModalOpen(false);
    } catch (err) {
      // El servidor explica por qué —la cuota del plan, un PIN repetido, una cuenta de otro
      // comercio— y esa explicación es justo lo que el encargado necesita leer.
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50/50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !branchId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="bg-red-50 text-red-600 p-4 rounded-lg">
          <p>Ocurrió un error al cargar los meseros o no hay sucursal activa.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto flex flex-col gap-6 h-full">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Meseros</h2>
          <p className="text-slate-500">Gestiona el personal de atención para esta sucursal</p>
        </div>
        <Button onClick={handleOpenCreate} className="shadow-sm">
          + Nuevo Mesero
        </Button>
      </div>

      {saveError && (
        <div className="bg-red-50 text-red-700 border border-red-200 rounded-xl px-4 py-3 text-sm">
          {saveError}
        </div>
      )}

      <ModuleGuard module="waiter_shifts" fallback={null}>
        <WaiterShiftsPanel branchId={branchId} cashSessionId={cashSessionId ?? null} />
      </ModuleGuard>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex-1">
        {waiters && waiters.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-100 text-slate-500 text-xs uppercase tracking-wider">
                  <th className="p-4 font-semibold">Nombre</th>
                  <th className="p-4 font-semibold">PIN (Seguridad)</th>
                  <th className="p-4 font-semibold">Estado</th>
                  <th className="p-4 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {waiters.map((waiter) => (
                  <tr key={waiter.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-4 font-medium">{waiter.name}</td>
                    <td className="p-4">
                      {waiter.has_pin ? <span className="font-mono bg-slate-100 px-2 py-1 rounded text-sm tracking-widest">••••</span> : <span className="text-slate-400 italic text-sm">Sin PIN</span>}
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${waiter.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {waiter.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <Button variant="outline" size="sm" onClick={() => handleOpenEdit(waiter)}>
                        Editar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-12 text-slate-500">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-2xl">
              🤵
            </div>
            <p className="text-lg font-medium text-slate-700">No hay meseros registrados</p>
            <p className="text-sm mt-1 mb-6 text-center max-w-sm">Agrega tu primer mesero para que pueda tomar pedidos en las mesas del restaurante.</p>
            <Button onClick={handleOpenCreate} variant="outline">Crear mi primer mesero</Button>
          </div>
        )}
      </div>

      <WaiterModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        waiter={editingWaiter}
        onSave={handleSave}
        isSaving={isCreating || isUpdating}
      />
    </div>
  );
}
