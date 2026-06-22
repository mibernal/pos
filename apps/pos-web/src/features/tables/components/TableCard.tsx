import React, { useEffect, useState } from 'react';
import { Table, TableStatus } from '@pos-dian/shared';
import { Clock, Users, Receipt } from 'lucide-react';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(amount);
};

interface TableCardProps {
  table: Table & { currentTotalCents?: number | null; orderCreatedAt?: string | null };
  waiterName?: string | null;
  onClick: (tableId: string) => void;
  onAssignWaiter?: (tableId: string) => void;
}

const statusColors: Record<TableStatus, string> = {
  AVAILABLE: 'bg-emerald-100 border-emerald-400 text-emerald-800 shadow-emerald-200',
  OCCUPIED: 'bg-rose-100 border-rose-400 text-rose-800 shadow-rose-200',
  RESERVED: 'bg-blue-100 border-blue-400 text-blue-800 shadow-blue-200',
  BILLING: 'bg-amber-100 border-amber-400 text-amber-800 shadow-amber-200',
  OUT_OF_ORDER: 'bg-gray-100 border-gray-400 text-gray-800 shadow-gray-200'
};

// --- Shared Global Timer Optimization ---
let globalTimerListeners: Array<(now: number) => void> = [];
let globalTimerInterval: NodeJS.Timeout | null = null;

const startGlobalTimer = () => {
  if (!globalTimerInterval) {
    globalTimerInterval = setInterval(() => {
      const now = Date.now();
      globalTimerListeners.forEach(listener => listener(now));
    }, 1000);
  }
};

const stopGlobalTimer = () => {
  if (globalTimerListeners.length === 0 && globalTimerInterval) {
    clearInterval(globalTimerInterval);
    globalTimerInterval = null;
  }
};

const useGlobalTimer = (active: boolean) => {
  const [now, setNow] = useState(Date.now());
  
  useEffect(() => {
    if (!active) return;
    const listener = (time: number) => setNow(time);
    globalTimerListeners.push(listener);
    startGlobalTimer();
    
    return () => {
      globalTimerListeners = globalTimerListeners.filter(l => l !== listener);
      stopGlobalTimer();
    };
  }, [active]);
  
  return now;
};
// ----------------------------------------

const statusLabels: Record<TableStatus, string> = {
  AVAILABLE: 'Libre',
  OCCUPIED: 'Ocupada',
  RESERVED: 'Reservada',
  BILLING: 'Facturando',
  OUT_OF_ORDER: 'Fuera de Servicio'
};

export const TableCard: React.FC<TableCardProps> = ({ table, waiterName, onClick, onAssignWaiter }) => {
  const [elapsedTime, setElapsedTime] = useState<string>('');
  const isTimerActive = table.status === 'OCCUPIED' || table.status === 'BILLING' || table.status === 'RESERVED';
  const now = useGlobalTimer(isTimerActive);

  useEffect(() => {
    if (!isTimerActive) {
      setElapsedTime('');
      return;
    }

    // Prefer orderCreatedAt (moment the first order was placed) for accurate restaurant occupation time.
    // This avoids resetting the timer on manual status edits or table transfers.
    // Falls back to statusUpdatedAt for RESERVED tables (which have no order).
    const timerRef = (table.status === 'OCCUPIED' || table.status === 'BILLING')
      ? (table.orderCreatedAt ?? table.statusUpdatedAt)
      : table.statusUpdatedAt;

    const start = new Date(timerRef).getTime();
    
    const diff = Math.floor((now - start) / 1000);
    if (diff < 0) {
      setElapsedTime('0m 0s');
      return;
    }
    
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;

    if (hours > 0) {
      setElapsedTime(`${hours}h ${minutes}m`);
    } else {
      setElapsedTime(`${minutes}m ${seconds}s`);
    }
  }, [table.status, table.statusUpdatedAt, table.orderCreatedAt, now, isTimerActive]);

  const colorClass = statusColors[table.status];

  return (
    <div 
      onClick={() => onClick(table.id)}
      className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:scale-[1.02] active:scale-95 shadow-sm hover:shadow-md flex flex-col justify-between aspect-square min-h-[160px] ${colorClass}`}
    >
      <div className="flex justify-between items-start">
        <h3 className="font-bold text-lg leading-tight truncate pr-2" title={table.name}>
          {table.name}
        </h3>
        <div className="flex items-center space-x-1 text-sm font-medium opacity-80 shrink-0">
          <Users size={14} />
          <span>{table.capacity}</span>
        </div>
      </div>

      <div className="flex-grow flex flex-col justify-center items-center py-2">
        <span className="font-semibold text-base uppercase tracking-wider">
          {statusLabels[table.status]}
        </span>
        
        {elapsedTime && (
          <div className="flex items-center space-x-1 mt-1 font-mono text-sm opacity-90">
            <Clock size={14} />
            <span>{elapsedTime}</span>
          </div>
        )}
      </div>

      <div className="h-6 flex items-end justify-between px-1">
        <div 
          className={`flex items-center space-x-1 text-xs opacity-80 truncate max-w-[60%] ${onAssignWaiter ? 'cursor-pointer hover:text-blue-700 hover:opacity-100 z-10 bg-white/50 rounded px-1 -ml-1' : ''}`}
          onClick={(e) => {
            if (onAssignWaiter) {
              e.stopPropagation();
              onAssignWaiter(table.id);
            }
          }}
          title={onAssignWaiter ? "Asignar mesero" : undefined}
        >
          {waiterName ? (
            <>
              <Users size={12} />
              <span className="truncate font-medium">{waiterName}</span>
            </>
          ) : (
            <span className="opacity-50 italic text-[10px] hover:not-italic hover:opacity-80 transition-all">+ Asignar mesero</span>
          )}
        </div>
        {(table.status === 'OCCUPIED' || table.status === 'BILLING') && table.currentTotalCents != null && (
          <div className="flex items-center space-x-1 font-bold">
            <Receipt size={14} />
            <span>{formatCurrency(table.currentTotalCents / 100)}</span>
          </div>
        )}
      </div>
    </div>
  );
};
