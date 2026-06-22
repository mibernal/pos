import React, { useState } from 'react';
import type { UserRole } from '../../../lib/api';

interface UserItem {
  id: string;
  name: string;
  role: UserRole;
  active: boolean;
}

interface AssignWaiterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAssign: (waiterId: string | null) => Promise<void>;
  users: UserItem[];
  currentWaiterId?: string | null;
  tableName: string;
}

export const AssignWaiterModal: React.FC<AssignWaiterModalProps> = ({
  isOpen,
  onClose,
  onAssign,
  users,
  currentWaiterId,
  tableName
}) => {
  const [selectedWaiterId, setSelectedWaiterId] = useState<string | null>(currentWaiterId || null);
  const [loading, setLoading] = useState(false);

  // We consider waiters any user that has role WAITER or ADMIN
  const waiters = users.filter(u => u.active && (u.role === 'WAITER' || u.role === 'ADMIN'));

  if (!isOpen) return null;

  const handleAssign = async () => {
    setLoading(true);
    try {
      await onAssign(selectedWaiterId);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 border-b shrink-0 bg-gray-50 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold">Asignar Mesero</h2>
            <p className="text-sm text-gray-500">Mesa: {tableName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <span className="sr-only">Cerrar</span>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-grow">
          <div className="space-y-2">
            <button
              onClick={() => setSelectedWaiterId(null)}
              className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                selectedWaiterId === null
                  ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                  : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
              }`}
            >
              Sin Mesero
            </button>
            {waiters.map(waiter => (
              <button
                key={waiter.id}
                onClick={() => setSelectedWaiterId(waiter.id)}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-colors flex justify-between items-center ${
                  selectedWaiterId === waiter.id
                    ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                    : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                }`}
              >
                <span>{waiter.name}</span>
                {waiter.role === 'ADMIN' && (
                  <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">Admin</span>
                )}
              </button>
            ))}
            
            {waiters.length === 0 && (
              <div className="text-center py-6 text-gray-500 bg-gray-50 rounded-lg border border-dashed">
                <p>No hay meseros activos disponibles.</p>
                <p className="text-sm mt-1">Crea usuarios con rol WAITER en Admin.</p>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t bg-gray-50 shrink-0 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded-lg hover:bg-gray-100 transition-colors font-medium text-gray-700"
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            onClick={handleAssign}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {loading ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Guardando...
              </>
            ) : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
};
