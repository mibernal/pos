import React, { useState } from 'react';
import { CreateRoomSchema, CreateRoomPayload } from '@pos-dian/shared';
import { useTablesStore } from '../store/useTablesStore';
import { useCreateRoom } from '../api/tables.api';
import { usePosStore } from '../../../hooks/usePosStore';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';

export const RoomManagerModal: React.FC = () => {
  const posContext = usePosStore(state => state.posContext);
  const { isCreateRoomModalOpen, closeCreateRoomModal, setSelectedRoomId } = useTablesStore();
  const { mutateAsync: createRoom, isPending } = useCreateRoom();

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!posContext?.branchId) return;

    const parseResult = CreateRoomSchema.safeParse({ name });
    if (!parseResult.success) {
      setError(parseResult.error.issues[0]?.message || 'Nombre inválido');
      return;
    }

    try {
      setError(null);
      const room = await createRoom({ branchId: posContext.branchId, payload: parseResult.data });
      setSelectedRoomId(room.id);
      closeModal();
    } catch (err) {
      console.error('Error creating room:', err);
      setError('Error al crear el salón');
    }
  };

  const closeModal = () => {
    setName('');
    setError(null);
    closeCreateRoomModal();
  };

  if (!isCreateRoomModalOpen) return null;

  return (
    <Modal ariaLabel="Nuevo Salón" onClose={closeModal}>
      <div className="sm:max-w-[425px]">
        <div>
          <h2 className="text-lg font-semibold">Nuevo Salón</h2>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Nombre del Salón
            </label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Ej. Terraza, Principal..."
              autoFocus
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
              {isPending ? 'Guardando...' : 'Crear Salón'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
};
