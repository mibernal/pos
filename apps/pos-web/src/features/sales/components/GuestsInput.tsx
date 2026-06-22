import React from 'react';

interface GuestsInputProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  variant?: 'light' | 'dark';
}

export function GuestsInput({ value, onChange, disabled, variant = 'dark' }: GuestsInputProps) {
  const isDark = variant === 'dark';
  
  return (
    <div className={`flex items-center gap-2 border rounded p-1 w-full ${
      isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500'
    }`}>
      <span className={`text-sm pl-2 ${isDark ? 'text-gray-400' : 'text-gray-600 font-medium'}`}>Personas:</span>
      <input
        type="number"
        min={1}
        max={50}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 1)}
        disabled={disabled}
        className={`bg-transparent w-full text-center focus:outline-none ${
          isDark ? 'text-white' : 'text-gray-900 font-semibold'
        }`}
      />
    </div>
  );
}
