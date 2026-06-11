import React from 'react';
import { Card } from '../../../components/ui';
import { PlatformActivityEvent } from '../../../lib/api/client';

export function RecentActivityWidget({ activity }: { activity: PlatformActivityEvent[] }) {
  if (!activity || !activity.length) return null;

  return (
    <Card className="p-6 max-h-[400px] overflow-y-auto mb-8">
      <h3 className="text-lg font-bold text-slate-900 mb-6">Actividad Reciente</h3>
      <div className="flex flex-col gap-4">
        {activity.map((event, i) => (
          <div key={event.id || i} className={`flex gap-4 pb-4 ${i < activity.length - 1 ? 'border-b border-slate-100' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              event.severity === 'WARNING' ? 'bg-warning-100 text-warning-600' : 
              event.severity === 'CRITICAL' ? 'bg-error-100 text-error-600' : 
              'bg-primary-100 text-primary-600'
            }`}>
              {event.severity === 'WARNING' ? '⚠️' : event.severity === 'CRITICAL' ? '🔴' : '🔹'}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">{event.type.replace(/_/g, ' ')}</p>
              <p className="text-xs text-slate-500 mt-1">Por {event.actor_email || 'Sistema'}</p>
              <p className="text-[11px] text-slate-400 mt-1">{new Date(event.created_at).toLocaleString('es-CO')}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
