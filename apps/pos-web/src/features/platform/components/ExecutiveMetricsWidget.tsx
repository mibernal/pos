import React from 'react';
import { Card } from '../../../components/ui';

export function ExecutiveMetricsWidget({ metrics }: { metrics: any }) {
  if (!metrics) return null;

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(cents / 100);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      <MetricCard title="MRR (Ingreso Mensual)" value={formatCurrency(metrics.mrrCents)} icon="💰" colorClass="text-primary-600 bg-primary-50" />
      <MetricCard title="ARR (Ingreso Anual)" value={formatCurrency(metrics.arrCents)} icon="📈" colorClass="text-green-600 bg-green-50" />
      <MetricCard title="Tenants Activos" value={metrics.activeTenants} subtitle={`de ${metrics.totalTenants} totales`} icon="🏢" colorClass="text-slate-600 bg-slate-100" />
      <MetricCard title="Trials Activos" value={metrics.activeTrials} icon="⏳" colorClass="text-yellow-600 bg-yellow-50" />
      <MetricCard title="Vencen Pronto" value={metrics.expiringSubscriptions} subtitle="En los próximos 30 días" icon="⚠️" colorClass="text-error-600 bg-error-50" />
      <MetricCard title="Usuarios Totales" value={metrics.totalUsers} icon="👥" colorClass="text-slate-600 bg-slate-100" />
    </div>
  );
}

function MetricCard({ title, value, subtitle, icon, colorClass }: any) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl ${colorClass}`}>
          {icon}
        </div>
        <h3 className="text-sm font-semibold text-slate-600">{title}</h3>
      </div>
      <p className="text-3xl font-extrabold text-slate-900 leading-none">{value}</p>
      {subtitle && <p className="text-xs text-slate-500 mt-2">{subtitle}</p>}
    </Card>
  );
}
