import React from 'react';

export function RecentActivityWidget({ activity }: { activity: any[] }) {
  if (!activity || !activity.length) return null;

  return (
    <div style={{ background: '#ffffff', borderRadius: '1.25rem', border: '1px solid var(--color-slate-200)', boxShadow: 'var(--shadow-sm)', marginBottom: '2rem', padding: '1.5rem', maxHeight: '400px', overflowY: 'auto' }}>
      <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-slate-900)', marginBottom: '1.5rem' }}>Actividad Reciente</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {activity.map((event, i) => (
          <div key={event.id || i} style={{ display: 'flex', gap: '1rem', paddingBottom: '1rem', borderBottom: i < activity.length - 1 ? '1px solid var(--color-slate-100)' : 'none' }}>
            <div style={{ 
              width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              background: event.severity === 'WARNING' ? 'var(--color-warning-100)' : event.severity === 'CRITICAL' ? 'var(--color-error-100)' : 'var(--color-primary-100)',
              color: event.severity === 'WARNING' ? 'var(--color-warning-600)' : event.severity === 'CRITICAL' ? 'var(--color-error-600)' : 'var(--color-primary-600)'
            }}>
              {event.severity === 'WARNING' ? '⚠️' : event.severity === 'CRITICAL' ? '🔴' : '🔹'}
            </div>
            <div>
              <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-slate-800)' }}>{event.type.replace(/_/g, ' ')}</p>
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-slate-500)' }}>Por {event.actor_email || 'Sistema'}</p>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-slate-400)', marginTop: '0.25rem' }}>{new Date(event.created_at).toLocaleString('es-CO')}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
