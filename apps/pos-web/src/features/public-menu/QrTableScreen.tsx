import { useCallback, useEffect, useState } from 'react';
import type { QrTableView } from '@pos-dian/shared';

/**
 * Carta y pedido desde la mesa.
 *
 * Es la pantalla del comensal: la abre escaneando el código de su mesa y no hay sesión
 * detrás. Todo lo que decide —qué se puede pedir, a qué precio— lo decide el servidor; aquí
 * solo se elige y se envía.
 */

function pesos(cents: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(cents / 100);
}

const BASE = `${import.meta.env.VITE_API_URL || ''}/api/v1/public/qr`;

export function QrTableScreen({ token }: { token: string }) {
  const [vista, setVista] = useState<QrTableView | null>(null);
  const [carrito, setCarrito] = useState<Record<string, number>>({});
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'no-existe' | 'error'>('cargando');
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const respuesta = await fetch(`${BASE}/${encodeURIComponent(token)}`);
      if (respuesta.status === 404) {
        setEstado('no-existe');
        return;
      }
      if (!respuesta.ok) throw new Error('No se pudo cargar la carta');
      setVista(await respuesta.json());
      setEstado('listo');
    } catch {
      setEstado('error');
    }
  }, [token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const totalCarrito = vista
    ? vista.menu
        .flatMap((categoria) => categoria.products)
        .reduce((total, producto) => total + (carrito[producto.id] ?? 0) * producto.price_cents, 0)
    : 0;

  async function enviar() {
    const items = Object.entries(carrito)
      .filter(([, qty]) => qty > 0)
      .map(([product_id, qty]) => ({ product_id, qty }));

    if (items.length === 0) return;

    setEnviando(true);
    setAviso(null);
    try {
      const respuesta = await fetch(`${BASE}/${encodeURIComponent(token)}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      if (!respuesta.ok) {
        const cuerpo = await respuesta.json().catch(() => null);
        throw new Error(cuerpo?.error?.message ?? 'No se pudo enviar el pedido.');
      }
      setCarrito({});
      setAviso('Pedido enviado a la cocina.');
      await cargar();
    } catch (err: unknown) {
      setAviso(err instanceof Error ? err.message : 'No se pudo enviar el pedido.');
    } finally {
      setEnviando(false);
    }
  }

  async function pedirCuenta() {
    setAviso(null);
    try {
      const respuesta = await fetch(`${BASE}/${encodeURIComponent(token)}/bill`, { method: 'POST' });
      if (!respuesta.ok) throw new Error('No se pudo avisar.');
      setAviso('Avisamos al salón. Ya vienen.');
      await cargar();
    } catch (err: unknown) {
      setAviso(err instanceof Error ? err.message : 'No se pudo avisar.');
    }
  }

  if (estado === 'cargando') {
    return <div className="min-h-screen bg-slate-50 p-6 animate-pulse" />;
  }

  if (estado === 'no-existe' || estado === 'error' || !vista) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-4xl mb-3">🍽️</p>
          <p className="text-slate-700 font-medium">Este código no está activo.</p>
          <p className="text-slate-500 text-sm mt-1">Pídele ayuda a alguien del salón.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-40">
      <header className="bg-white border-b border-slate-200 px-5 py-4 sticky top-0 z-10">
        <h1 className="text-lg font-bold text-slate-900">{vista.branch_name}</h1>
        <p className="text-sm text-slate-500">{vista.table_name}</p>
      </header>

      {aviso && (
        <div className="mx-5 mt-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3 text-sm">
          {aviso}
        </div>
      )}

      {vista.order && vista.order.lines.length > 0 && (
        <section className="mx-5 mt-4 bg-white rounded-2xl border border-slate-200 p-4">
          <h2 className="font-semibold text-slate-800 mb-2">Lo que llevas</h2>
          <ul className="text-sm divide-y divide-slate-100">
            {vista.order.lines.map((linea, indice) => (
              <li key={indice} className="py-1.5 flex justify-between gap-3">
                <span className="text-slate-700">
                  {linea.qty} × {linea.product_name}
                </span>
                <span className="tabular-nums text-slate-600">{pesos(linea.line_total_cents)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex justify-between font-semibold text-slate-900">
            <span>Total</span>
            <span className="tabular-nums">{pesos(vista.order.total_cents)}</span>
          </p>
          <button
            className="mt-3 w-full border border-slate-300 rounded-xl py-2.5 text-sm font-medium text-slate-700 disabled:opacity-50"
            onClick={() => void pedirCuenta()}
            disabled={vista.order.bill_requested}
          >
            {vista.order.bill_requested ? 'Ya pediste la cuenta' : 'Pedir la cuenta'}
          </button>
        </section>
      )}

      {vista.menu.map((categoria) => (
        <section key={categoria.name} className="mx-5 mt-6">
          <h2 className="font-bold text-slate-900 mb-2">{categoria.name}</h2>
          <ul className="space-y-2">
            {categoria.products.map((producto) => (
              <li key={producto.id} className="bg-white rounded-2xl border border-slate-200 p-4 flex gap-3">
                <div className="flex-1">
                  <p className="font-medium text-slate-900">{producto.name}</p>
                  {producto.description && (
                    <p className="text-sm text-slate-500 mt-0.5">{producto.description}</p>
                  )}
                  <p className="text-sm font-semibold text-slate-800 mt-1">{pesos(producto.price_cents)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    aria-label={`Quitar ${producto.name}`}
                    className="w-9 h-9 rounded-full border border-slate-300 text-lg leading-none disabled:opacity-40"
                    disabled={!carrito[producto.id]}
                    onClick={() =>
                      setCarrito((previo) => ({
                        ...previo,
                        [producto.id]: Math.max(0, (previo[producto.id] ?? 0) - 1)
                      }))
                    }
                  >
                    −
                  </button>
                  <span className="w-5 text-center tabular-nums">{carrito[producto.id] ?? 0}</span>
                  <button
                    aria-label={`Añadir ${producto.name}`}
                    className="w-9 h-9 rounded-full bg-slate-900 text-white text-lg leading-none"
                    onClick={() =>
                      setCarrito((previo) => ({
                        ...previo,
                        [producto.id]: Math.min(20, (previo[producto.id] ?? 0) + 1)
                      }))
                    }
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {totalCarrito > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 p-4">
          <button
            className="w-full bg-slate-900 text-white rounded-xl py-3.5 font-semibold disabled:opacity-60"
            onClick={() => void enviar()}
            disabled={enviando}
          >
            {enviando ? 'Enviando…' : `Pedir · ${pesos(totalCarrito)}`}
          </button>
          <p className="text-center text-xs text-slate-500 mt-2">
            El pedido va directo a la cocina. Se paga al final, en la mesa.
          </p>
        </div>
      )}
    </div>
  );
}
