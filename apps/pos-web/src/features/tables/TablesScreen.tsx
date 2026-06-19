import React, { useState } from 'react';
import { useGetRooms } from './api/tables.api';
import { useTablesStore } from './store/useTablesStore';
import { usePosStore } from '../../hooks/usePosStore';
import { useTablesWebSocket } from './hooks/useTablesWebSocket';
import { TableCard } from './components/TableCard';
import { RoomManagerModal } from './components/RoomManagerModal';
import { TableManagerModal } from './components/TableManagerModal';
import { Plus, Settings } from 'lucide-react';
import { Button } from '../../components/ui/Button';

import type { AppRoute } from '../../types';

export const TablesScreen: React.FC<{ onNavigate?: (route: AppRoute) => void }> = ({ onNavigate }) => {
  const posContext = usePosStore((state) => state.posContext);
  const currentBranchId = posContext?.branchId;
  const { data: rooms, isLoading, error } = useGetRooms(currentBranchId);
  
  // Conectar a WebSockets para actualizaciones en tiempo real
  useTablesWebSocket(currentBranchId);
  
  const { 
    selectedRoomId, 
    setSelectedRoomId, 
    openCreateRoomModal,
    openCreateTableModal,
    openTableDetails,
    setActiveTable
  } = useTablesStore();

  // Handle default room selection
  React.useEffect(() => {
    if (rooms && rooms.length > 0 && !selectedRoomId) {
      setSelectedRoomId(rooms[0]!.id);
    }
  }, [rooms, selectedRoomId, setSelectedRoomId]);

  if (!currentBranchId) {
    return <div className="p-8 text-center text-gray-500">Selecciona una sucursal para ver las mesas.</div>;
  }

  if (isLoading) {
    return <div className="p-8 text-center text-gray-500">Cargando salones...</div>;
  }

  if (error) {
    return <div className="p-8 text-center text-red-500">Error al cargar salones: {(error as Error).message}</div>;
  }

  const activeRoom = rooms?.find(r => r.id === selectedRoomId) || rooms?.[0];

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header & Room Tabs */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex-1 flex items-center space-x-2 overflow-x-auto no-scrollbar">
          {rooms?.map(room => (
            <button
              key={room.id}
              onClick={() => setSelectedRoomId(room.id)}
              className={`px-4 py-2 rounded-full font-medium text-sm whitespace-nowrap transition-colors ${
                selectedRoomId === room.id 
                  ? 'bg-blue-600 text-white shadow-sm' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {room.name}
            </button>
          ))}
          <button
            onClick={openCreateRoomModal}
            className="flex items-center space-x-1 px-4 py-2 rounded-full font-medium text-sm whitespace-nowrap border-2 border-dashed border-gray-300 text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors"
          >
            <Plus size={16} />
            <span>Nuevo Salón</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {!activeRoom ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Settings size={48} className="opacity-20 mb-4" />
            <p>No hay salones creados.</p>
            <Button onClick={openCreateRoomModal} className="mt-4">
              Crear tu primer Salón
            </Button>
          </div>
        ) : (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">{activeRoom.name}</h2>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => openCreateTableModal(activeRoom.id)}
                className="flex items-center space-x-2"
              >
                <Plus size={16} />
                <span>Agregar Mesa</span>
              </Button>
            </div>

            {activeRoom.tables.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center flex flex-col items-center justify-center">
                <p className="text-gray-500 mb-4">Este salón aún no tiene mesas.</p>
                <Button onClick={() => openCreateTableModal(activeRoom.id)}>
                  Crear primera mesa
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
                {activeRoom.tables.map(table => (
                  <TableCard 
                    key={table.id} 
                    table={table} 
                    onClick={(id) => {
                      const t = activeRoom.tables.find(x => x.id === id);
                      if (t) {
                        setActiveTable(t);
                        onNavigate?.('pos');
                      }
                    }} 
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      <RoomManagerModal />
      <TableManagerModal />
      {/* <TableActionsModal /> */}
    </div>
  );
};
