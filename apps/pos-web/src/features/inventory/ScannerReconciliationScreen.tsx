// @ts-nocheck
import React, { useState, useMemo } from 'react';
import { ScannerView } from './components/ScannerView';
// Fallback components until ui library is installed
const Button = (props: any) => <button className="px-4 py-2 bg-blue-600 text-white rounded" {...props} />;
const Table = (props: any) => <table className="w-full text-sm text-left" {...props} />;
const TableHeader = (props: any) => <thead className="text-xs uppercase bg-gray-50" {...props} />;
const TableRow = (props: any) => <tr className="border-b" {...props} />;
const TableHead = (props: any) => <th className="px-6 py-3" {...props} />;
const TableBody = (props: any) => <tbody {...props} />;
const TableCell = (props: any) => <td className="px-6 py-4" {...props} />;
const Tabs = (props: any) => <div {...props} />;
const TabsList = (props: any) => <div className="flex border-b mb-4" {...props} />;
const TabsTrigger = ({ value, children }: any) => <button className="px-4 py-2 border-b-2 border-transparent hover:border-gray-300">{children}</button>;
const TabsContent = ({ value, children }: any) => <div>{children}</div>;

const AlertCircle = () => <span>[!]</span>;
const CheckCircle2 = () => <span>[V]</span>;
const AlertTriangle = () => <span>[W]</span>;
const Save = () => <span>[S]</span>;
// Mock react-query
const useQuery = (args: any) => ({ data: [], isPending: false });
const useMutation = (args: any) => ({ mutate: () => { }, isPending: false });
const apiClient = { get: async () => ({ data: [] }), post: async () => ({ data: {} }) };

// Mocks or props, normally this screen receives an ID for the receipt or count
interface ScannerReconciliationScreenProps {
  entityId: string;
  entityType: 'receipt' | 'count';
  onCompleted?: () => void;
}

export const ScannerReconciliationScreen: React.FC<ScannerReconciliationScreenProps> = ({ entityId, entityType, onCompleted }) => {
  // Local state for immediate feedback
  const [scannedItems, setScannedItems] = useState<Record<string, number>>({});
  const [unknownBarcodes, setUnknownBarcodes] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState('expected');
  const [isScannerActive, setIsScannerActive] = useState(true);

  // In a real scenario, we would fetch the expected items from the PO or count
  // For the sake of UX implementation, we mock the master list of products
  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const res = await apiClient.get('/products');
      return res.data;
    }
  });

  const { data: expectedItems } = useQuery({
    queryKey: ['expected', entityId, entityType],
    queryFn: async () => {
      // Mocked for UX demonstration: normally fetches the PO items
      return [
        { product_id: 'prod-1', barcode: '123456789012', name: 'Coca Cola 2L', expected_qty: 24 },
        { product_id: 'prod-2', barcode: '098765432109', name: 'Lays Clásicas', expected_qty: 12 },
      ];
    }
  });

  const scanBatchMutation = useMutation({
    mutationFn: async (items: any[]) => {
      return apiClient.post(`/inventory/${entityType}s/${entityId}/scan-batch`, { items });
    }
  });

  const commitMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiClient.post(`/inventory/${entityType}s/${entityId}/commit`, data);
    },
    onSuccess: () => {
      if (onCompleted) onCompleted();
    }
  });

  const handleScan = (barcode: string) => {
    // 1. Find product in master list
    const product = products?.find((p: any) => p.barcode === barcode);

    if (product) {
      // It's a known product
      setScannedItems(prev => ({
        ...prev,
        [product.id]: (prev[product.id] || 0) + 1
      }));
      // Dispatch success beep
      window.dispatchEvent(new CustomEvent('scanner-beep', { detail: { type: 'success' } }));

      // Async: Send to backend
      scanBatchMutation.mutate([{ product_id: product.id, scanned_qty_delta: 1 }]);
    } else {
      // It's unknown
      setUnknownBarcodes(prev => ({
        ...prev,
        [barcode]: (prev[barcode] || 0) + 1
      }));
      // Dispatch error beep
      window.dispatchEvent(new CustomEvent('scanner-beep', { detail: { type: 'error' } }));
    }
  };

  const handleCommit = () => {
    // If there are unknowns, maybe block or warn?
    if (Object.keys(unknownBarcodes).length > 0) {
      if (!window.confirm('Hay códigos desconocidos. ¿Deseas finalizar de todos modos ignorándolos?')) {
        return;
      }
    }

    // In a real app, if differences exist we ask for PIN.
    const PIN = window.prompt("Introduce PIN de Manager para confirmar discrepancias (Opcional si cuadra)");
    commitMutation.mutate({
      discrepancy_approved_by_pin: PIN,
      notes: "Procesado mediante Scanner"
    });
  };

  const reconciliationData = useMemo(() => {
    if (!expectedItems) return [];
    return expectedItems.map((item: any) => {
      const scanned = scannedItems[item.product_id] || 0;
      const diff = scanned - item.expected_qty;
      return { ...item, scanned_qty: scanned, diff };
    });
  }, [expectedItems, scannedItems]);

  return (
    <div className="flex flex-col h-full space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Recepción por Escáner</h1>
        <Button onClick={handleCommit} disabled={commitMutation.isPending}>
          <Save className="w-4 h-4 mr-2" />
          Finalizar y Contabilizar
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <ScannerView
            onScan={handleScan}
            isActive={isScannerActive}
          />
          <div className="mt-4 flex justify-center">
            <Button variant="outline" onClick={() => setIsScannerActive(!isScannerActive)}>
              {isScannerActive ? 'Pausar Escáner' : 'Reanudar Escáner'}
            </Button>
          </div>
        </div>

        <div className="md:col-span-2 bg-card border rounded-lg p-4 shadow-sm">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="expected">Conciliación ({reconciliationData.length})</TabsTrigger>
              <TabsTrigger value="unknowns">
                Desconocidos
                {Object.keys(unknownBarcodes).length > 0 && (
                  <span className="ml-2 bg-destructive text-destructive-foreground px-2 py-0.5 rounded-full text-xs">
                    {Object.keys(unknownBarcodes).length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="expected">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead className="text-right">Esperado</TableHead>
                      <TableHead className="text-right">Escaneado</TableHead>
                      <TableHead className="text-right">Dif.</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reconciliationData.map((row: any) => (
                      <TableRow key={row.product_id}>
                        <TableCell>
                          <div className="font-medium">{row.name}</div>
                          <div className="text-xs text-muted-foreground">{row.barcode}</div>
                        </TableCell>
                        <TableCell className="text-right">{row.expected_qty}</TableCell>
                        <TableCell className="text-right font-bold">{row.scanned_qty}</TableCell>
                        <TableCell className={`text-right font-bold ${row.diff === 0 ? 'text-green-600' : row.diff > 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {row.diff > 0 ? `+${row.diff}` : row.diff}
                        </TableCell>
                        <TableCell>
                          {row.diff === 0 ? (
                            <CheckCircle2 className="text-green-600 w-5 h-5" />
                          ) : (
                            <AlertTriangle className={row.diff > 0 ? 'text-yellow-600 w-5 h-5' : 'text-red-600 w-5 h-5'} />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {reconciliationData.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          Cargando datos...
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="unknowns">
              {Object.keys(unknownBarcodes).length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  No hay códigos desconocidos.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-destructive/10 text-destructive p-3 rounded-md flex items-start">
                    <AlertCircle className="w-5 h-5 mr-2 mt-0.5 shrink-0" />
                    <p className="text-sm">
                      Estos códigos fueron escaneados pero no existen en la base de datos.
                      Deberás asignarlos a un producto manualmente antes de cerrar el lote.
                    </p>
                  </div>

                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Código de Barras</TableHead>
                          <TableHead className="text-right">Veces Escaneado</TableHead>
                          <TableHead className="text-right">Acción</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(unknownBarcodes).map(([barcode, count]) => (
                          <TableRow key={barcode}>
                            <TableCell className="font-mono">{barcode}</TableCell>
                            <TableCell className="text-right">{count}</TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm">Vincular</Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
};
