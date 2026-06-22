import React from 'react';
import { useGetWaiters } from '../../tables/api/waiters.api';

interface WaiterSelectorProps {
  branchId: string;
  value: string | null;
  onChange: (waiterId: string | null) => void;
  disabled?: boolean;
  variant?: 'light' | 'dark';
}

export function WaiterSelector({ branchId, value, onChange, disabled, variant = 'dark' }: WaiterSelectorProps) {
  const { data: waiters, isLoading } = useGetWaiters(branchId);

  const baseClasses = variant === 'dark' 
    ? "bg-gray-800 border border-gray-700 text-white focus:ring-blue-500" 
    : "bg-white border border-gray-300 text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

  if (isLoading) {
    return (
      <select disabled className={`${baseClasses} rounded p-2 text-sm w-full outline-none opacity-75`}>
        <option>Cargando...</option>
      </select>
    );
  }

  const activeWaiters = waiters?.filter(w => w.is_active) || [];

  return (
    <select
      disabled={disabled}
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      className={`${baseClasses} rounded p-2 text-sm w-full outline-none`}
    >
      <option value="">Seleccionar mesero</option>
      {activeWaiters.map(waiter => (
        <option key={waiter.id} value={waiter.id}>
          {waiter.name}
        </option>
      ))}
    </select>
  );
}
