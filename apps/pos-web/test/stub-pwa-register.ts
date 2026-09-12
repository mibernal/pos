/**
 * `virtual:pwa-register` lo fabrica `vite-plugin-pwa` al construir, y ese plugin no corre
 * en Vitest. Sin algo que resolver, cualquier prueba que toque el árbol de la app falla al
 * cargarse — ni siquiera llega a ejecutarse.
 *
 * Este relevo existe solo para que el import resuelva. Las pruebas que de verdad miran el
 * comportamiento lo sustituyen con `vi.mock`.
 */
export function registerSW(_opciones?: {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
}): (recargar?: boolean) => Promise<void> {
  return () => Promise.resolve();
}
