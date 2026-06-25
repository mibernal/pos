import { useState } from 'react';
import { useGetActiveTickets, useUpdateTicketStatus } from './api/kds.api';
import { useKdsSync } from './hooks/useKdsSync';
import { KitchenTicketWithItems } from '@pos-dian/shared';

const STATUS_COLUMNS = [
  { id: 'HOLD', title: 'En Espera (Tiempos)' },
  { id: 'PENDING', title: 'Pendientes' },
  { id: 'PREPARING', title: 'En Preparación' },
  { id: 'READY', title: 'Listos' }
];

export function KitchenScreen({ branchId }: { branchId: string }) {
  // Use the branchId from props
  
  // Connect to SSE to automatically invalidate queries
  const { isConnected } = useKdsSync(branchId);

  const { data: tickets = [], isLoading, isError, refetch } = useGetActiveTickets(branchId);
  const { mutate: updateStatus } = useUpdateTicketStatus();

  if (isLoading) {
    return <div className="p-8 text-center text-gray-400">Cargando tickets de cocina...</div>;
  }

  if (isError) {
    return <div className="p-8 text-center text-red-500">Error al cargar tickets</div>;
  }

  const handleStatusChange = (ticketId: string, newStatus: string) => {
    updateStatus({ branchId, id: ticketId, status: newStatus });
  };

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white overflow-hidden">
      <header className="p-4 bg-gray-900 border-b border-gray-800 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">Kitchen Display System</h1>
          <div className="flex items-center gap-2 text-sm px-2">
            <span className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
            <span className={isConnected ? 'text-green-400' : 'text-red-400'}>
              {isConnected ? 'Conectado' : 'Desconectado'}
            </span>
          </div>
          <button 
            onClick={() => refetch()} 
            className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-sm rounded border border-gray-700 transition-colors"
          >
            Sincronizar
          </button>
        </div>
        <div className="flex gap-4 text-sm text-gray-400">
          <span>Tickets activos: {tickets.length}</span>
        </div>
      </header>

      <div className="flex flex-1 overflow-x-auto p-4 gap-4">
        {STATUS_COLUMNS.map(column => {
          const columnTickets = tickets.filter(t => t.status === column.id);

          return (
            <div key={column.id} className="flex-1 min-w-[350px] bg-gray-900 rounded-xl flex flex-col border border-gray-800">
              <div className="p-4 border-b border-gray-800 font-semibold text-gray-300 flex justify-between items-center shrink-0">
                <h2>{column.title}</h2>
                <span className="bg-gray-800 text-xs px-2 py-1 rounded-full">{columnTickets.length}</span>
              </div>

              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                {columnTickets.map(ticket => (
                  <TicketCard 
                    key={ticket.id} 
                    ticket={ticket} 
                    onStatusChange={(status) => handleStatusChange(ticket.id, status)} 
                  />
                ))}
                {columnTickets.length === 0 && (
                  <div className="text-center text-gray-600 italic py-8">
                    Sin tickets
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TicketCard({ ticket, onStatusChange }: { ticket: KitchenTicketWithItems, onStatusChange: (status: string) => void }) {
  // A helper to calculate time elapsed
  const minutesElapsed = Math.floor((new Date().getTime() - new Date(ticket.created_at).getTime()) / 60000);
  const isUrgent = minutesElapsed > 15;

  return (
    <div className={`p-4 rounded-lg border ${isUrgent ? 'border-red-900/50 bg-red-950/20' : 'border-gray-700 bg-gray-800'} flex flex-col gap-3 shadow-lg`}>
      <div className="flex justify-between items-start border-b border-gray-700 pb-2">
        <div>
          <span className="text-sm font-mono text-gray-400">TKT-{ticket.id.slice(0, 6).toUpperCase()}</span>
          {ticket.course && ticket.course > 1 && (
            <span className="ml-2 px-2 py-0.5 bg-yellow-900/50 text-yellow-500 rounded text-xs border border-yellow-700/50">
              Tiempo {ticket.course}
            </span>
          )}
          <div className="font-bold text-lg">Mesa/Pedido</div>
        </div>
        <div className={`text-sm font-bold ${isUrgent ? 'text-red-400' : 'text-gray-400'}`}>
          {minutesElapsed} min
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {ticket.items.map(item => (
          <div key={item.id} className="flex flex-col">
            <div className="flex gap-2 items-start">
              <span className="font-bold text-blue-400">{item.qty}x</span>
              <span className="text-gray-100">{item.product_id} {/* Ideally resolve product name */}</span>
            </div>
            {item.notes && (
              <span className="text-sm text-yellow-500 italic ml-6">Nota: {item.notes}</span>
            )}
          </div>
        ))}
      </div>

      <div className="pt-2 border-t border-gray-700 flex gap-2 justify-end mt-2">
        {ticket.status === 'PENDING' && (
          <button 
            onClick={() => onStatusChange('PREPARING')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium transition-colors"
          >
            Preparar
          </button>
        )}
        {ticket.status === 'PREPARING' && (
          <button 
            onClick={() => onStatusChange('READY')}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded font-medium transition-colors"
          >
            Listo
          </button>
        )}
        {ticket.status === 'READY' && (
          <button 
            onClick={() => onStatusChange('DELIVERED')}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded font-medium transition-colors"
          >
            Entregado
          </button>
        )}
      </div>
    </div>
  );
}
