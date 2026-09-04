import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Banner, Button, Card } from '../../../components/ui';
import { useApi } from '../../auth';

/**
 * Códigos QR por mesa.
 *
 * El QR de la carta pública se puede generar con un servicio externo: lleva una URL que no
 * es secreta. **Este no.** El token de la mesa es la credencial que permite escribir en la
 * cocina, y mandarlo a un servidor ajeno para que dibuje un cuadrado sería regalarlo. Se
 * dibuja aquí, en el navegador del comercio.
 */

interface Mesa {
  id: string;
  name: string;
}

export function TableQrPanel({ tables }: { tables: Mesa[] }) {
  const api = useApi();
  const [seleccionada, setSeleccionada] = useState<string>('');
  const [token, setToken] = useState<string | null>(null);
  const [nombre, setNombre] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const lienzo = useRef<HTMLCanvasElement>(null);

  const url = token ? `${window.location.origin}/mesa/${token}` : null;

  const dibujar = useCallback(async () => {
    if (!url || !lienzo.current) return;
    await QRCode.toCanvas(lienzo.current, url, { width: 320, margin: 2 });
  }, [url]);

  useEffect(() => {
    void dibujar();
  }, [dibujar]);

  async function generar() {
    if (!seleccionada) return;
    setGenerando(true);
    setError(null);
    try {
      const respuesta = await api.issueTableQrToken(seleccionada);
      setToken(respuesta.qr_token);
      setNombre(respuesta.name);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerando(false);
    }
  }

  function imprimir() {
    if (!lienzo.current || !url) return;
    const imagen = lienzo.current.toDataURL('image/png');
    const ventana = window.open('', '_blank');
    if (!ventana) return;

    ventana.document.write(
      `<html><head><title>${nombre}</title><style>` +
        'body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}' +
        'h1{font-size:2rem;margin:0 0 .25rem}p{color:#555;margin:.25rem 0 1rem}img{width:70vw;max-width:420px}' +
        `</style></head><body><h1>${nombre}</h1><p>Escanea para ver la carta y pedir</p><img src="${imagen}" alt="QR"/></body></html>`
    );
    ventana.document.close();
    ventana.focus();
    setTimeout(() => ventana.print(), 400);
  }

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h3 className="font-bold text-foreground">Código QR por mesa</h3>
        <p className="text-sm text-muted-foreground">
          Cada mesa lleva el suyo. El comensal escanea, ve la carta y pide a esa mesa.
        </p>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      <div className="flex flex-wrap gap-2 items-center">
        <select
          className="border border-border rounded-lg px-3 py-2 bg-background text-sm"
          value={seleccionada}
          onChange={(evento) => {
            setSeleccionada(evento.target.value);
            setToken(null);
          }}
        >
          <option value="">Elige una mesa…</option>
          {tables.map((mesa) => (
            <option key={mesa.id} value={mesa.id}>
              {mesa.name}
            </option>
          ))}
        </select>
        <Button onClick={() => void generar()} disabled={!seleccionada || generando}>
          {generando ? 'Generando…' : token ? 'Generar uno nuevo' : 'Generar código'}
        </Button>
        {token && (
          <Button variant="outline" onClick={imprimir}>
            Imprimir
          </Button>
        )}
      </div>

      <div className={token ? 'flex flex-col items-center gap-3' : 'hidden'}>
        <canvas ref={lienzo} />
        <p className="text-xs text-muted-foreground text-center max-w-sm">
          Generar uno nuevo invalida el anterior al instante. Es lo que hay que hacer si un
          código acaba fotografiado donde no debía: se imprime otro papel, no se cambia la mesa.
        </p>
      </div>
    </Card>
  );
}
