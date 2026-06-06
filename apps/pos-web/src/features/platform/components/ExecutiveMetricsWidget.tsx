import React from 'react';

export function ExecutiveMetricsWidget({ metrics }: { metrics: any }) {
  if (!metrics) return null;

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(cents / 100);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
      <MetricCard title="MRR (Ingreso Mensual)" value={formatCurrency(metrics.mrrCents)} icon="💰" color="var(--color-primary-600)" bg="var(--color-primary-50)" />
      <MetricCard title="ARR (Ingreso Anual)" value={formatCurrency(metrics.arrCents)} icon="📈" color="var(--color-success-600)" bg="var(--color-success-50)" />
      <MetricCard title="Tenants Activos" value={metrics.activeTenants} subtitle={`de ${metrics.totalTenants} totales`} icon="🏢" color="var(--color-slate-600)" bg="var(--color-slate-100)" />
      <MetricCard title="Trials Activos" value={metrics.activeTrials} icon="⏳" color="var(--color-warning-600)" bg="var(--color-warning-50)" />
      <MetricCard title="Vencen Pronto" value={metrics.expiringSubscriptions} subtitle="En los próximos 30 días" icon="⚠️" color="var(--color-error-600)" bg="var(--color-error-50)" />
      <MetricCard title="Usuarios Totales" value={metrics.totalUsers} icon="👥" color="var(--color-slate-600)" bg="var(--color-slate-100)" />
    </div>
  );
}

function MetricCard({ title, value, subtitle, icon, color, bg }: any) {
  return (
    <div style={{ background: '#ffffff', borderRadius: '1.25rem', padding: '1.5rem', border: '1px solid var(--color-slate-200)', boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '0.5rem', background: bg, color: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem' }}>
          {icon}
        </div>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-slate-600)' }}>{title}</h3>
      </div>
      <p style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-slate-900)', lineHeight: 1 }}>{value}</p>
      {subtitle && <p style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '0.5rem' }}>{subtitle}</p>}
    </div>
  );
}
