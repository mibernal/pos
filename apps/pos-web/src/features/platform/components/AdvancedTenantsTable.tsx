import React, { useState } from 'react';

export function AdvancedTenantsTable({ 
  tenants, 
  onEdit, // we will use this to open the drawer
  onImpersonate,
  onCreate,
  onSearch, 
  onFilterStatus 
}: any) {
  const [searchTerm, setSearchTerm] = useState('');

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    // basic debounce
    setTimeout(() => onSearch(e.target.value), 300);
  };

  return (
    <div style={{ background: '#ffffff', borderRadius: '1.25rem', border: '1px solid var(--color-slate-200)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
      <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--color-slate-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-slate-900)' }}>Directorio de Organizaciones</h2>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <input 
            type="text" 
            placeholder="Buscar por NIT, nombre, email..." 
            value={searchTerm}
            onChange={handleSearch}
            style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--color-slate-300)', minWidth: '250px' }}
          />
          <select 
            onChange={(e) => onFilterStatus(e.target.value)}
            style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--color-slate-300)' }}
          >
            <option value="ALL">Todos los Estados</option>
            <option value="ACTIVE">Activos</option>
            <option value="SUSPENDED">Suspendidos</option>
            <option value="TRIALING">En Trial</option>
          </select>
          <button 
            onClick={onCreate}
            style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none', backgroundColor: 'var(--color-primary-600)', color: 'white', fontWeight: 600, cursor: 'pointer' }}
          >
            + Nuevo Tenant
          </button>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px' }}>
          <thead style={{ background: 'var(--color-slate-50)' }}>
            <tr>
              <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-slate-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Negocio</th>
              <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-slate-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Estado</th>
              <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-slate-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Plan & MRR</th>
              <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-slate-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Creado</th>
              <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-slate-500)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t: any) => (
              <tr key={t.id} style={{ borderBottom: '1px solid var(--color-slate-100)', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--color-slate-50)'} onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                <td style={{ padding: '1.25rem 1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '0.5rem', background: 'var(--color-primary-50)', color: 'var(--color-primary-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', fontWeight: 700 }}>
                      {t.business_name?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--color-slate-900)', fontSize: '0.9375rem' }}>{t.business_name}</div>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--color-slate-500)', marginTop: '0.125rem' }}>NIT: {t.document_number} | {t.owner_email}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '1.25rem 1.5rem' }}>
                  <span style={{ 
                    padding: '0.375rem 0.75rem', 
                    borderRadius: '9999px', 
                    fontSize: '0.75rem', 
                    fontWeight: 600,
                    backgroundColor: t.status === 'ACTIVE' ? 'var(--color-success-100)' : t.status === 'SUSPENDED' ? 'var(--color-error-100)' : 'var(--color-warning-100)',
                    color: t.status === 'ACTIVE' ? 'var(--color-success-700)' : t.status === 'SUSPENDED' ? 'var(--color-error-700)' : 'var(--color-warning-700)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.375rem'
                  }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: t.status === 'ACTIVE' ? 'var(--color-success-500)' : t.status === 'SUSPENDED' ? 'var(--color-error-500)' : 'var(--color-warning-500)' }}></span>
                    {t.status === 'ACTIVE' ? 'Activo' : t.status === 'SUSPENDED' ? 'Suspendido' : t.status}
                  </span>
                </td>
                <td style={{ padding: '1.25rem 1.5rem' }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-slate-700)' }}>
                    {t.plan_name || 'Sin plan'}
                  </div>
                  {t.plan_price_cents && (
                    <div style={{ fontSize: '0.8125rem', color: 'var(--color-slate-500)', marginTop: '0.125rem' }}>
                      {new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(t.plan_price_cents / 100)} / mes
                    </div>
                  )}
                </td>
                <td style={{ padding: '1.25rem 1.5rem' }}>
                  <div style={{ fontSize: '0.875rem', color: 'var(--color-slate-700)' }}>{new Date(t.created_at).toLocaleDateString('es-CO')}</div>
                </td>
                <td style={{ padding: '1.25rem 1.5rem', textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button 
                      style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--color-slate-200)', borderRadius: '0.5rem', backgroundColor: '#ffffff', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-slate-700)' }} 
                      onClick={() => onEdit(t)}
                    >
                      Ver Detalles
                    </button>
                    <button 
                      style={{ padding: '0.5rem 0.75rem', border: 'none', borderRadius: '0.5rem', backgroundColor: 'var(--color-slate-900)', color: 'white', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600 }} 
                      onClick={() => onImpersonate(t.id)}
                    >
                      Ingresar &rarr;
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
