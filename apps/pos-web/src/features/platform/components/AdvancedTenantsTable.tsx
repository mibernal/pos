import React, { useState } from 'react';
import { Card, Button, Input } from '../../../components/ui';
import { PlatformTenantSearchResult } from '../../../lib/api/client';

interface AdvancedTenantsTableProps {
  tenants: PlatformTenantSearchResult[];
  onEdit: (tenant: PlatformTenantSearchResult) => void;
  onImpersonate: (tenantId: string) => void;
  onCreate: () => void;
  onSearch: (query: string) => void;
  onFilterStatus: (status: string) => void;
}

/**
 * Cambiar de plan, suspender y reactivar se hacen desde `TenantDetailDrawer`, que es donde
 * están el motivo de suspensión y el catálogo de planes. La tabla recibía además
 * `onChangePlan`, `onSuspend` y `onReactivate` y no invocaba ninguno: tres props muertas y
 * un TODO que hacía pensar que las acciones no existían en ninguna parte. Se retiran.
 */
export function AdvancedTenantsTable({
  tenants,
  onEdit, // abre el drawer, donde están las acciones
  onImpersonate,
  onCreate,
  onSearch,
  onFilterStatus
}: AdvancedTenantsTableProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    // basic debounce
    setTimeout(() => onSearch(e.target.value), 300);
  };

  return (
    <Card className="overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-slate-900">Directorio de Organizaciones</h2>
        <div className="flex flex-col sm:flex-row gap-4">
          <Input 
            type="text" 
            placeholder="Buscar por NIT, nombre, email..." 
            value={searchTerm}
            onChange={handleSearch}
            className="min-w-[250px]"
          />
          <select 
            onChange={(e) => onFilterStatus(e.target.value)}
            className="flex h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <option value="ALL">Todos los Estados</option>
            <option value="ACTIVE">Activos</option>
            <option value="SUSPENDED">Suspendidos</option>
            <option value="TRIALING">En Trial</option>
          </select>
          <Button onClick={onCreate}>
            + Nuevo Tenant
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left min-w-[800px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Negocio</th>
              <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Estado</th>
              <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Plan & MRR</th>
              <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Creado</th>
              <th className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50">
                <td className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center text-xl font-bold shrink-0">
                      {t.business_name?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 text-sm">{t.business_name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">NIT: {t.document_number} | {t.owner_email}</div>
                    </div>
                  </div>
                </td>
                <td className="p-4">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                    t.status === 'ACTIVE' ? 'bg-success-100 text-success-700' : 
                    t.status === 'SUSPENDED' ? 'bg-error-100 text-error-700' : 
                    'bg-warning-100 text-warning-700'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      t.status === 'ACTIVE' ? 'bg-success-500' : 
                      t.status === 'SUSPENDED' ? 'bg-error-500' : 
                      'bg-warning-500'
                    }`}></span>
                    {t.status === 'ACTIVE' ? 'Activo' : t.status === 'SUSPENDED' ? 'Suspendido' : t.status}
                  </span>
                </td>
                <td className="p-4">
                  <div className="text-sm font-semibold text-slate-700">
                    {t.plan_name || 'Sin plan'}
                  </div>
                  {t.plan_price_cents && (
                    <div className="text-xs text-slate-500 mt-0.5">
                      {new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(t.plan_price_cents / 100)} / mes
                    </div>
                  )}
                </td>
                <td className="p-4">
                  <div className="text-sm text-slate-700">{new Date(t.created_at).toLocaleDateString('es-CO')}</div>
                </td>
                <td className="p-4 text-right">
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() => onEdit(t)}>
                      Ver Detalles
                    </Button>
                    <Button size="sm" onClick={() => onImpersonate(t.id)}>
                      Ingresar &rarr;
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
