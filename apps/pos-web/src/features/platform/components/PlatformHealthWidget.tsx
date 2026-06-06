import React from 'react';

export function PlatformHealthWidget({ health }: { health: any }) {
  if (!health) return null;

  return (
    <div style={{ background: '#ffffff', borderRadius: '1.25rem', border: '1px solid var(--color-slate-200)', boxShadow: 'var(--shadow-sm)', marginBottom: '2rem', padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-slate-900)' }}>Estado de la Plataforma</h3>
        <span style={{ 
          padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600,
          background: health.status === 'Healthy' ? 'var(--color-success-100)' : 'var(--color-warning-100)',
          color: health.status === 'Healthy' ? 'var(--color-success-700)' : 'var(--color-warning-700)',
        }}>
          {health.status}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
        {health.services?.map((svc: any, i: number) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', background: 'var(--color-slate-50)', borderRadius: '0.75rem' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-slate-700)' }}>{svc.name}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: 'var(--color-slate-500)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: svc.status === 'Healthy' ? 'var(--color-success-500)' : 'var(--color-error-500)' }} />
              {svc.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
