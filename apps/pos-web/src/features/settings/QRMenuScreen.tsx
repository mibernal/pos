import { PageHeader } from '../../components/ui';
import { usePosStore } from '../../hooks/usePosStore';
import { useGetRooms } from '../tables/api/tables.api';
import { TableQrPanel } from './components/TableQrPanel';

export function QRMenuScreen() {
  const posContext = usePosStore(state => state.posContext);
  const { data: rooms } = useGetRooms(posContext?.branchId);
  const mesas = (rooms ?? []).flatMap((room) => room.tables.map((mesa) => ({ id: mesa.id, name: mesa.name })));

  if (!posContext?.branchId) {
    return <div className="p-8 text-center text-gray-500">Selecciona una sucursal primero.</div>;
  }

  // The public menu URL for this branch
  const publicMenuUrl = `${window.location.origin}/menu/${posContext.branchId}`;
  
  // We use a free, robust public API for QR code generation to avoid heavy dependencies on the client
  const qrCodeImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(publicMenuUrl)}&margin=10`;

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Imprimir QR Menú</title>
          <style>
            body { 
              font-family: system-ui, -apple-system, sans-serif; 
              display: flex; 
              flex-direction: column; 
              align-items: center; 
              justify-content: center; 
              height: 100vh; 
              margin: 0; 
              text-align: center; 
            }
            img { max-width: 80vw; max-height: 60vh; }
            h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
            p { font-size: 1.5rem; color: #555; }
          </style>
        </head>
        <body>
          <h1>Escanea para ver nuestro Menú</h1>
          <img src="${qrCodeImageUrl}" alt="Menu QR" />
          <p>¡Haz tu pedido rápidamente!</p>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    // Allow image to load before printing
    setTimeout(() => {
      printWindow.print();
    }, 500);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title="Menú Digital (QR)"
        subtitle="El QR de la sucursal es para mirar la carta. El de cada mesa, además, deja pedir."
      />

      <TableQrPanel tables={mesas} />

      <div style={{ 
        display: 'flex', 
        gap: '2rem', 
        backgroundColor: 'white', 
        padding: '2rem', 
        borderRadius: '0.75rem', 
        border: '1px solid var(--color-neutral-200)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
      }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--color-neutral-800)' }}>
            Instrucciones
          </h3>
          <p style={{ color: 'var(--color-neutral-600)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
            Este código QR dirigirá a tus clientes a una página optimizada para celulares donde podrán explorar todos los productos activos de esta sucursal agrupados por categoría.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', backgroundColor: 'var(--color-neutral-50)', padding: '1rem', borderRadius: '0.5rem' }}>
            <div>
              <span style={{ fontWeight: 600, display: 'block', fontSize: '0.875rem', color: 'var(--color-neutral-500)' }}>URL Pública:</span>
              <a href={publicMenuUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary-600)', wordBreak: 'break-all' }}>
                {publicMenuUrl}
              </a>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
            <button
              onClick={handlePrint}
              style={{
                backgroundColor: 'var(--color-primary-600)',
                color: 'white',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '0.375rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              Imprimir Código QR
            </button>
            <a
              href={qrCodeImageUrl}
              download="menu-qr.png"
              target="_blank"
              style={{
                backgroundColor: 'white',
                color: 'var(--color-neutral-700)',
                border: '1px solid var(--color-neutral-300)',
                padding: '0.75rem 1.5rem',
                borderRadius: '0.375rem',
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              Descargar PNG
            </a>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', border: '2px dashed var(--color-neutral-300)', borderRadius: '1rem', backgroundColor: 'var(--color-neutral-50)' }}>
          <img 
            src={qrCodeImageUrl} 
            alt="Menú QR" 
            style={{ width: '250px', height: '250px', borderRadius: '0.5rem', mixBlendMode: 'multiply' }} 
          />
          <p style={{ marginTop: '1rem', color: 'var(--color-neutral-500)', fontSize: '0.875rem' }}>
            Escanea para previsualizar
          </p>
        </div>
      </div>
    </div>
  );
}
