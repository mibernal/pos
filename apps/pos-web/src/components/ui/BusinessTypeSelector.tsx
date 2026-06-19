import { BUSINESS_TYPE_CATALOG, type BusinessType } from '@pos-dian/shared';
import { Card } from './Card';
import { Label } from './Label';
import { Input } from './Input';

interface BusinessTypeSelectorProps {
  value: BusinessType;
  onChange: (value: BusinessType) => void;
  customValue?: string;
  onCustomValueChange?: (value: string) => void;
  enableTables?: boolean;
  onEnableTablesChange?: (value: boolean) => void;
  layout?: 'grid' | 'select';
  className?: string;
}

export function BusinessTypeSelector({
  value,
  onChange,
  customValue = '',
  onCustomValueChange,
  enableTables = false,
  onEnableTablesChange,
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
            {onEnableTablesChange && (
              <div className="flex items-center gap-2 mt-2">
                <input 
                  type="checkbox" 
                  id="enable_tables"
                  checked={enableTables}
                  onChange={(e) => onEnableTablesChange(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <Label htmlFor="enable_tables" className="font-normal cursor-pointer">
                  ¿Necesita funcionalidad de mesas?
                </Label>
              </div>
            )}
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
          {onEnableTablesChange && (
            <div className="flex items-center gap-2 mt-1">
              <input 
                type="checkbox" 
                id="enable_tables_grid"
                checked={enableTables}
                onChange={(e) => onEnableTablesChange(e.target.checked)}
                className="h-4 w-4 rounded border-primary/30 text-primary focus:ring-primary"
              />
              <Label htmlFor="enable_tables_grid" className="font-normal cursor-pointer">
                Habilitar gestión de mesas y pedidos
              </Label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
