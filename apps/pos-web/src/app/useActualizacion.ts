import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { useCartStore } from '../features/sales/hooks/useCartStore';

/**
 * Cuándo se aplica una versión nueva en una caja.
 *
 * El problema que resuelve es concreto y estuvo abierto desde que se montó la PWA: la app
 * instalaba la versión nueva y **no la aplicaba**. `registerSW({ immediate: true })` deja
 * que el service worker nuevo tome el control, pero la pestaña abierta sigue ejecutando el
 * JS y el CSS que cargó al abrirse. Un cajero no cierra la pestaña en todo el día, así que
 * un arreglo se desplegaba y no lo veía nadie — incluido, la primera vez que pasó, el
 * arreglo del desborde del historial.
 *
 * Recargar en cuanto llega tampoco vale: se lleva por delante el carrito a medio montar, y
 * perder una comanda por una actualización es peor que la actualización.
 *
 * Así que se recarga cuando no cuesta nada: si no hay nada en el carrito, sola y en
 * silencio. Si hay una venta empezada, se avisa y espera — y se aplica en cuanto el
 * carrito se vacía, que es justo después de cobrar. El cajero no tiene que hacer nada.
 */
export function useActualizacion() {
  const [hayVersionNueva, setHayVersionNueva] = useState(false);
  const aplicar = useRef<(recargar?: boolean) => Promise<void>>();
  const cartItems = useCartStore((s) => s.cartItems);

  useEffect(() => {
    // Sin guarda de `'serviceWorker' in navigator`: `registerSW` ya la hace por dentro, y
    // ponerla aquí además de allí solo servía para que el navegador de las pruebas —que no
    // tiene service workers— saliera antes de registrar nada y dejara esto sin probar.
    aplicar.current = registerSW({
      immediate: true,
      onNeedRefresh() {
        setHayVersionNueva(true);
      }
    });
  }, []);

  // Se aplica sola en cuanto la caja está libre: al entrar sin venta empezada, o en el
  // momento en que se cobra la que había.
  useEffect(() => {
    if (!hayVersionNueva) return;
    if (cartItems.length > 0) return;
    void aplicar.current?.(true);
  }, [hayVersionNueva, cartItems.length]);

  return {
    /** Solo es cierto mientras hay una venta en curso: si no, ya se habrá recargado. */
    hayVersionNueva: hayVersionNueva && cartItems.length > 0,
    aplicarAhora: () => void aplicar.current?.(true)
  };
}
