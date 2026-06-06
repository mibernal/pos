import React from 'react';
import { Card } from '../../../components/ui';

export function PlatformHealthWidget({ health }: { health: any }) {
  if (!health) return null;

  return (
    <Card className="p-6 mb-8">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-bold text-slate-900">Estado de la Plataforma</h3>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
          health.status === 'Healthy' ? 'bg-success-100 text-success-700' : 'bg-warning-100 text-warning-700'
        }`}>
          {health.status}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {health.services?.map((svc: any, i: number) => (
          <div key={i} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
            <span className="text-sm font-semibold text-slate-700">{svc.name}</span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className={`w-2 h-2 rounded-full ${svc.status === 'Healthy' ? 'bg-success-500' : 'bg-error-500'}`} />
              {svc.status}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
