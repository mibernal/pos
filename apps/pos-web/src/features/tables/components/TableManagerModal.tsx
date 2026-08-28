import React, { useState } from 'react';
import { CreateTableSchema } from '@pos-dian/shared';
import { useTablesStore } from '../store/useTablesStore';
import { useCreateTable } from '../api/tables.api';
import { usePosStore } from '../../../hooks/usePosStore';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';

export const TableManagerModal: React.FC = () => {
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState(4);
  const [error, setError] = useState<string | null>(null);

  const posContext = usePosStore(state => state.posContext);
  const { isCreateTableModalOpen, closeCreateTableModal, selectedRoomId } = useTablesStore();
  const { mutateAsync: createTable, isPending } = useCreateTable();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!posContext?.branchId || !selectedRoomId) return;

    const parseResult = CreateTableSchema.safeParse({ name, capacity });
    if (!parseResult.success) {
      setError(parseResult.error.issues[0]?.message || 'Datos inválidos');
      return;
    }

    try {
      setError(null);
      await createTable({ 
        branchId: posContext.branchId,
        roomId: selectedRoomId, 
        payload: parseResult.data 
      });
      closeModal();
    } catch (err) {
      console.error('Error creating table:', err);
      setError('Error al crear la mesa');
    }
  };

  const closeModal = () => {
    setName('');
    setCapacity(4);
    setError(null);
    closeCreateTableModal();
  };

  if (!isCreateTableModalOpen) return null;

  return (
    <Modal ariaLabel="Nueva Mesa" onClose={closeModal}>
      <div className="sm:max-w-[425px]">
        <div>
          <h2 className="text-lg font-semibold">Nueva Mesa</h2>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium leading-none">
              Nombre / Número de Mesa
            </label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="Ej. Mesa 1, Barra 2..."
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="capacity" className="text-sm font-medium leading-none">
              Capacidad (Personas)
            </label>
            <input
              id="capacity"
              type="number"
              min="1"
              value={capacity}
              onChange={(e) => setCapacity(parseInt(e.target.value) || 1)}
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {error && (
              <p className="text-sm text-red-500 font-medium">{error}</p>
            )}
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={closeModal} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Guardando...' : 'Crear Mesa'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
};
