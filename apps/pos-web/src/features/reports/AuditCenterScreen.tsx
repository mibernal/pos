import React, { useCallback, useEffect, useState } from 'react';
import type { PosApiClient } from '../../types';

export function AuditCenterScreen({ api }: { api: PosApiClient }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedCorrelation, setSelectedCorrelation] = useState<string | null>(null);
  const [correlationLogs, setCorrelationLogs] = useState<any[]>([]);

  // Filters
  const [branchId, setBranchId] = useState('');
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const params = new URLSearchParams();
      if (branchId) params.set('branch_id', branchId);
      if (userId) params.set('user_id', userId);
      if (action) params.set('action', action);

      const res = await fetch(`${api.baseUrl}/admin/audit-logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.items);
        setTotal(data.total);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [api.baseUrl, branchId, userId, action]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const viewCorrelation = async (cid: string) => {
    setSelectedCorrelation(cid);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`${api.baseUrl}/admin/audit-logs/${cid}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setCorrelationLogs(data.items);
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto flex gap-6">
      <div className="flex-1 space-y-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Centro de Auditoría</h1>
          <p className="text-muted-foreground">Trazabilidad forense de operaciones en el sistema ({total} eventos)</p>
        </div>

        {/* Filters */}
        <div className="flex gap-4 mb-4">
          <input 
            type="text" 
            placeholder="Filtrar por User ID..." 
            className="border p-2 rounded-md"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <input 
            type="text" 
            placeholder="Filtrar por Branch ID..." 
            className="border p-2 rounded-md"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          />
          <select 
            className="border p-2 rounded-md bg-white"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <option value="">Todas las acciones</option>
            <option value="UPDATE">UPDATE</option>
            <option value="CREATE">CREATE</option>
            <option value="DELETE">DELETE</option>
            <option value="VOID">VOID</option>
          </select>
          <button onClick={loadLogs} className="px-4 py-2 bg-blue-600 text-white rounded-md">Refrescar</button>
        </div>

        {/* Timeline */}
        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500 animate-pulse">Cargando eventos...</div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Usuario</th>
                  <th className="px-4 py-3">Sucursal</th>
                  <th className="px-4 py-3">Acción</th>
                  <th className="px-4 py-3">Entidad</th>
                  <th className="px-4 py-3">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((log) => (
                  <tr 
                    key={log.id} 
                    className="hover:bg-blue-50 cursor-pointer transition-colors"
                    onClick={() => log.correlation_id && viewCorrelation(log.correlation_id)}
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {log.user_name || 'Sistema'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {log.branch_name || 'Global'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded-full font-bold
                        ${log.action === 'DELETE' || log.action === 'VOID' ? 'bg-red-100 text-red-700' : ''}
                        ${log.action === 'CREATE' ? 'bg-green-100 text-green-700' : ''}
                        ${log.action === 'UPDATE' ? 'bg-blue-100 text-blue-700' : ''}
                      `}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {log.entity_type} <br/>
                      <span className="text-[10px] text-gray-400">{log.entity_id.substring(0,8)}...</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                      {log.ip_address || '127.0.0.1'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Sidebar: Correlation / Diff Viewer */}
      {selectedCorrelation && (
        <div className="w-1/3 bg-gray-50 border-l border-gray-200 p-6 h-[calc(100vh-4rem)] overflow-y-auto sticky top-0 shadow-inner">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-bold">Detalle de Transacción</h2>
            <button onClick={() => setSelectedCorrelation(null)} className="text-gray-400 hover:text-black">✖</button>
          </div>
          <div className="mb-4">
            <span className="text-xs text-gray-500 block">Correlation ID</span>
            <span className="text-sm font-mono bg-gray-200 px-2 py-1 rounded">{selectedCorrelation}</span>
          </div>

          <div className="space-y-6">
            {correlationLogs.map((clog, idx) => (
              <div key={clog.id} className="bg-white border rounded-lg p-4 shadow-sm relative">
                <div className="absolute -left-[35px] top-4 w-6 h-6 rounded-full bg-blue-100 border-2 border-blue-500 flex items-center justify-center text-xs font-bold text-blue-700">
                  {idx + 1}
                </div>
                <div className="flex justify-between items-start mb-2">
                  <span className="font-bold">{clog.action} {clog.entity_type}</span>
                  <span className="text-xs text-gray-500">{new Date(clog.created_at).toLocaleTimeString()}</span>
                </div>
                
                {/* Diff Viewer */}
                {clog.old_values && (
                  <div className="mt-3">
                    <p className="text-xs font-bold text-red-600 mb-1">Valores Anteriores (old_values):</p>
                    <pre className="text-[10px] bg-red-50 text-red-900 p-2 rounded overflow-x-auto">
                      {JSON.stringify(clog.old_values, null, 2)}
                    </pre>
                  </div>
                )}
                {clog.new_values && (
                  <div className="mt-3">
                    <p className="text-xs font-bold text-green-600 mb-1">Nuevos Valores (new_values):</p>
                    <pre className="text-[10px] bg-green-50 text-green-900 p-2 rounded overflow-x-auto">
                      {JSON.stringify(clog.new_values, null, 2)}
                    </pre>
                  </div>
                )}
                {clog.legacy_payload && Object.keys(clog.legacy_payload).length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-bold text-gray-500 mb-1">Payload Legado:</p>
                    <pre className="text-[10px] bg-gray-100 p-2 rounded overflow-x-auto">
                      {JSON.stringify(clog.legacy_payload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
