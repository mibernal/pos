import { BUSINESS_TYPE_CATALOG, type BusinessType } from '@pos-dian/shared';
import { Card } from './Card';
import { Label } from './Label';
import { Input } from './Input';

export interface BusinessModulesConfig {
  enable_tables: boolean;
  enable_delivery: boolean;
  enable_waiters: boolean;
  enable_split_bill: boolean;
  enable_tips: boolean;
  enable_kitchen: boolean;
  enable_kitchen_display: boolean;
  enable_kitchen_tickets: boolean;
  enable_kitchen_printing: boolean;
  enable_order_rounds: boolean;
  enable_product_modifiers: boolean;
  enable_reservations: boolean;
  enable_waiter_shifts: boolean;
  enable_qr_menu: boolean;
}

interface BusinessTypeSelectorProps {
  value: BusinessType;
  onChange: (value: BusinessType) => void;
  customValue?: string;
  onCustomValueChange?: (value: string) => void;
  modules?: BusinessModulesConfig;
  onModulesChange?: (modules: BusinessModulesConfig) => void;
  layout?: 'grid' | 'select';
  className?: string;
}

export function BusinessTypeSelector({
  value,
  onChange,
  customValue = '',
  onCustomValueChange,
  modules,
  onModulesChange,
  layout = 'grid',
  className = ''
}: BusinessTypeSelectorProps) {
  
  if (layout === 'select') {
    return (
      <div className={`flex flex-col gap-4 ${className}`}>
        <div className="grid gap-2">
          <Label htmlFor="business_type">Tipo de Negocio</Label>
          <select 
            id="business_type" 
            value={value} 
            onChange={(e) => onChange(e.target.value as BusinessType)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {BUSINESS_TYPE_CATALOG.map((type) => (
              <option key={type.value} value={type.value}>
                {type.icon} {type.label}
              </option>
            ))}
          </select>
        </div>
        
        {value === 'OTHER' && (
          <div className="flex flex-col gap-4 p-4 border border-border rounded-lg bg-muted/20 animate-in fade-in slide-in-from-top-2">
            <div className="grid gap-2">
              <Label htmlFor="custom_business_type">Especifique el tipo de negocio</Label>
              <Input 
                id="custom_business_type" 
                value={customValue} 
                onChange={(e) => onCustomValueChange?.(e.target.value)}
                placeholder="Ej. Veterinaria, Spa, etc."
                required
              />
            </div>
          </div>
        )}
        
        {modules && onModulesChange && (
          <div className="flex flex-col gap-4 p-4 border border-border rounded-lg bg-muted/10 animate-in fade-in slide-in-from-top-2 mt-2">
            <div className="grid gap-2">
              <Label className="mb-3 block font-semibold text-primary">Configuración Avanzada de Módulos</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Object.entries({
                  enable_tables: 'Mesas y Salones',
                  enable_delivery: 'Domicilios',
                  enable_waiters: 'Meseros',
                  enable_split_bill: 'División de Cuenta',
                  enable_tips: 'Propinas',
                  enable_kitchen: 'Cocina',
                  enable_kitchen_display: 'KDS (Pantallas)',
                  enable_kitchen_tickets: 'Tickets de Cocina',
                  enable_kitchen_printing: 'Impresoras de Cocina',
                  enable_order_rounds: 'Rondas de Pedidos',
                  enable_product_modifiers: 'Modificadores',
                  enable_reservations: 'Reservaciones',
                  enable_waiter_shifts: 'Turnos de Meseros',
                  enable_qr_menu: 'Menú QR'
                }).map(([key, label]) => (
                  <div key={key} className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id={`mod_${key}`}
                      checked={modules[key as keyof BusinessModulesConfig]}
                      onChange={(e) => onModulesChange({ ...modules, [key]: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <Label htmlFor={`mod_${key}`} className="font-normal cursor-pointer text-sm">
                      {label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <Label>¿Qué tipo de negocio tienes?</Label>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[300px] overflow-y-auto p-1">
        {BUSINESS_TYPE_CATALOG.map((type) => (
          <button
            key={type.value}
            type="button"
            onClick={() => onChange(type.value)}
            className={`
              flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all
              ${value === type.value 
                ? 'border-primary bg-primary/10 text-primary shadow-sm ring-1 ring-primary' 
                : 'border-border bg-card text-muted-foreground hover:bg-muted/50 hover:border-muted-foreground/30'}
            `}
          >
            <span className="text-2xl mb-2">{type.icon}</span>
            <span className="text-xs font-medium leading-tight">{type.label}</span>
          </button>
        ))}
      </div>

      {value === 'OTHER' && (
        <div className="flex flex-col gap-4 p-4 mt-2 border border-primary/20 rounded-lg bg-primary/5 animate-in fade-in slide-in-from-top-2">
          <div className="grid gap-2">
            <Label htmlFor="custom_business_type" className="text-primary">Especifique su negocio</Label>
            <Input 
              id="custom_business_type" 
              value={customValue} 
              onChange={(e) => onCustomValueChange?.(e.target.value)}
              placeholder="Ej. Veterinaria, Spa, Gimnasio..."
              required
              className="border-primary/20 focus-visible:ring-primary/30"
            />
          </div>
        </div>
      )}
      
      {modules && onModulesChange && (
        <div className="mt-4 pt-4 border-t border-primary/20">
          <Label className="mb-3 block font-semibold text-primary">Configuración Avanzada de Módulos</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries({
                enable_tables: 'Mesas y Salones',
                enable_delivery: 'Domicilios',
                enable_waiters: 'Meseros',
                enable_split_bill: 'División de Cuenta',
                enable_tips: 'Propinas',
                enable_kitchen: 'Cocina',
                enable_kitchen_display: 'KDS (Pantallas)',
                enable_kitchen_tickets: 'Tickets de Cocina',
                enable_kitchen_printing: 'Impresoras de Cocina',
                enable_order_rounds: 'Rondas de Pedidos',
                enable_product_modifiers: 'Modificadores',
                enable_reservations: 'Reservaciones',
                enable_waiter_shifts: 'Turnos de Meseros',
                enable_qr_menu: 'Menú QR'
              }).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    id={`mod_grid_${key}`}
                    checked={modules[key as keyof BusinessModulesConfig]}
                    onChange={(e) => onModulesChange({ ...modules, [key]: e.target.checked })}
                    className="h-4 w-4 rounded border-primary/30 text-primary focus:ring-primary"
                  />
                  <Label htmlFor={`mod_grid_${key}`} className="font-normal cursor-pointer text-sm">
                    {label}
                  </Label>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
