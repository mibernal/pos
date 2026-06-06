import React, { useState, useEffect, useRef } from 'react';
import { useSession } from '../auth';
import { usePosStore } from '../../hooks';

export function BulkImportScreen() {
  const { api } = useSession();
  const { posContext } = usePosStore();
  const selectedBranchId = posContext?.branchId;
  
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [jobData, setJobData] = useState<{
    jobId: string;
    fileName: string;
    totalRows: number;
    validRows: number;
    invalidRows: number;
    previewValid: any[];
    previewErrors: any[];
  } | null>(null);
  
  const [jobStatus, setJobStatus] = useState<any>(null);
  const [polling, setPolling] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0] || null);
      setError(null);
      setJobData(null);
      setJobStatus(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    
    setUploading(true);
    setError(null);
    
    try {
      const data = await api.uploadEnterpriseBulk(file);
      setJobData(data);
    } catch (err: any) {
      setError(err.message || 'Error al procesar el archivo');
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!jobData || !selectedBranchId) return;
    
    setUploading(true);
    try {
      await api.confirmEnterpriseBulk(jobData.jobId, selectedBranchId);
      setPolling(true);
    } catch (err: any) {
      setError(err.message || 'Error al encolar el trabajo');
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (!polling || !jobData) return;
    
    const interval = setInterval(async () => {
      try {
        const status = await api.getEnterpriseBulkStatus(jobData.jobId);
        setJobStatus(status);
        
        if (status.status === 'COMPLETED' || status.status === 'FAILED') {
          setPolling(false);
          clearInterval(interval);
        }
      } catch (err) {
        console.error('Error polling status', err);
      }
    }, 2000);
    
    return () => clearInterval(interval);
  }, [polling, jobData, api]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Importación Masiva (Enterprise)</h1>
        <button 
          className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          onClick={() => window.history.back()}
        >
          Volver
        </button>
      </div>
      
      {!selectedBranchId && (
        <div className="p-4 mb-4 text-sm text-yellow-800 rounded-lg bg-yellow-50 dark:bg-gray-800 dark:text-yellow-300" role="alert">
          Debes seleccionar una sucursal en el menú superior para poder realizar la importación.
        </div>
      )}
      
      <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm dark:bg-gray-800 dark:border-gray-700">
        <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800">
          <svg className="w-12 h-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
          </svg>
          <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">
            <span className="font-semibold">Haz clic para subir</span> o arrastra un archivo
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">CSV o XLSX (Max 50.000 filas)</p>
          <input 
            type="file" 
            ref={fileInputRef}
            className="mt-4 block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 dark:text-gray-400 focus:outline-none dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400" 
            accept=".csv, .xlsx, .xls"
            onChange={handleFileChange}
          />
        </div>
        
        {file && !jobData && (
          <div className="mt-4 flex justify-end">
            <button 
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              onClick={handleUpload} 
              disabled={uploading || !selectedBranchId}
            >
              {uploading ? 'Procesando...' : 'Analizar Archivo'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 mb-4 text-sm text-red-800 rounded-lg bg-red-50 dark:bg-gray-800 dark:text-red-400" role="alert">
          {error}
        </div>
      )}

      {jobData && !jobStatus && (
        <div className="space-y-6 mt-6">
          <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm dark:bg-gray-800 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Resumen del Archivo</h3>
            <div className="grid grid-cols-3 gap-4 mt-4">
              <div className="p-4 bg-gray-50 rounded-lg text-center dark:bg-gray-700">
                <div className="text-2xl font-bold text-gray-900 dark:text-white">{jobData.totalRows}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Filas Totales</div>
              </div>
              <div className="p-4 bg-green-50 rounded-lg text-center dark:bg-gray-700">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">{jobData.validRows}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Válidas</div>
              </div>
              <div className="p-4 bg-red-50 rounded-lg text-center dark:bg-gray-700">
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">{jobData.invalidRows}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">Con Errores</div>
              </div>
            </div>
            
            <div className="mt-6 flex justify-end gap-4">
              <button 
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
                onClick={() => setJobData(null)}
              >
                Cancelar
              </button>
              <button 
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                onClick={handleConfirm} 
                disabled={uploading || jobData.validRows === 0}
              >
                {uploading ? 'Iniciando...' : `Importar ${jobData.validRows} registros`}
              </button>
            </div>
          </div>
          
          {jobData.previewErrors.length > 0 && (
            <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm dark:bg-gray-800 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-red-600 flex items-center gap-2 mb-4">
                Preview de Errores
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-gray-500 dark:text-gray-400">
                  <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
                    <tr>
                      <th className="px-6 py-3">Fila</th>
                      <th className="px-6 py-3">Error</th>
                      <th className="px-6 py-3">Datos Originales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobData.previewErrors.map((err, i) => (
                      <tr key={i} className="bg-white border-b dark:bg-gray-800 dark:border-gray-700">
                        <td className="px-6 py-4">{err.rowNumber}</td>
                        <td className="px-6 py-4 text-red-500 font-medium">{err.error}</td>
                        <td className="px-6 py-4">
                          <pre className="text-xs max-w-md overflow-hidden text-ellipsis whitespace-nowrap">
                            {JSON.stringify(err.rowData)}
                          </pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {jobStatus && (
        <div className="p-6 bg-white border border-gray-200 rounded-lg shadow-sm dark:bg-gray-800 dark:border-gray-700 mt-6">
          <div className="text-center space-y-4 py-8">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Estado de la Importación</h3>
            <div className="flex justify-center gap-4">
              <span className={`px-3 py-1 text-sm font-medium rounded-full ${
                jobStatus.status === 'COMPLETED' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 
                jobStatus.status === 'FAILED' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' : 
                'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300'
              }`}>
                {jobStatus.status}
              </span>
            </div>
            
            <div className="max-w-xl mx-auto mt-6">
              <div className="flex justify-between mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
                <span>Progreso ({jobStatus.processedRows} / {jobStatus.validRows})</span>
                <span>{Math.round((jobStatus.processedRows / (jobStatus.validRows || 1)) * 100)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-4 dark:bg-gray-700">
                <div 
                  className={`h-4 rounded-full ${jobStatus.status === 'COMPLETED' ? 'bg-green-600' : 'bg-blue-600'}`} 
                  style={{ width: `${Math.round((jobStatus.processedRows / (jobStatus.validRows || 1)) * 100)}%` }}
                ></div>
              </div>
            </div>
            
            {jobStatus.status === 'COMPLETED' && (
              <div className="mt-8">
                <div className="p-4 mb-4 text-sm text-green-800 rounded-lg bg-green-50 dark:bg-gray-800 dark:text-green-400" role="alert">
                  ¡Importación completada con éxito! Se han procesado {jobStatus.processedRows} productos.
                </div>
                <button 
                  className="px-4 py-2 mt-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  onClick={() => window.location.reload()}
                >
                  Nueva Importación
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
