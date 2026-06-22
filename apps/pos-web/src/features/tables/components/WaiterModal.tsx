import React, { useState, useEffect } from 'react';
import { Button } from '../../../components/ui/Button';
import type { Waiter } from '@pos-dian/shared';

interface WaiterModalProps {
  isOpen: boolean;
  onClose: () => void;
  waiter: Waiter | null;
  onSave: (data: { name: string; pin: string | null; is_active: boolean }) => void;
  isSaving: boolean;
}

export function WaiterModal({ isOpen, onClose, waiter, onSave, isSaving }: WaiterModalProps) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (isOpen) {
      setName(waiter?.name ?? '');
      setPin(waiter?.pin ?? '');
      setIsActive(waiter?.is_active ?? true);
    }
  }, [isOpen, waiter]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name: name.trim(),
      pin: pin.trim() || null,
      is_active: isActive
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 text-gray-800 animate-in fade-in zoom-in duration-200">
        <h3 className="text-xl font-bold mb-4">{waiter ? 'Editar Mesero' : 'Nuevo Mesero'}</h3>
        
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold">Nombre Completo</label>
            <input 
              type="text" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="p-2 border rounded border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Ej: Juan Pérez"
              required
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold">PIN de Acceso (Opcional)</label>
            <input 
              type="text" 
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              maxLength={4}
              className="p-2 border rounded border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Ej: 1234"
              pattern="\d{4}"
              title="Debe contener 4 dígitos"
            />
            <span className="text-xs text-gray-500">Si se configura, se pedirá para tomar pedidos.</span>
          </div>

          <div className="flex items-center gap-2 mt-2">
            <input 
              type="checkbox" 
              id="isActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <label htmlFor="isActive" className="text-sm font-semibold cursor-pointer">
              Mesero Activo
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 mt-2">
            <Button variant="outline" onClick={onClose} type="button" disabled={isSaving}>Cancelar</Button>
            <Button type="submit" disabled={!name.trim() || isSaving}>
              {isSaving ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
