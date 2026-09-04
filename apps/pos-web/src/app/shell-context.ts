import { useOutletContext } from 'react-router-dom';
import type { TenantTaxMode } from '@pos-dian/shared';
import type { AppRoute, PosApiClient } from '../types';
import type { TicketTemplateConfig } from '../lib/ticket-template';
import type { AuthSession } from '../lib/api';
import type { PosContext } from '../lib/session';
import type { PendingSaleRecord } from '../lib/offline-queue';

/**
 * Lo que el armazón le presta a la pantalla que hay dentro.
 *
 * Antes esto se enhebraba a mano en una cadena de `if/else` de 200 líneas: cada pantalla
 * recibía sus props ahí, y añadir una ruta era editar ese bloque. Con el enrutador, la
 * pantalla ya no la elige nadie —la elige la URL— así que el armazón deja lo compartido en
 * el contexto del `Outlet` y cada ruta toma lo que necesita.
 */
export interface ShellContext {
  api: PosApiClient;
  session: AuthSession;
  posContext: PosContext | null;
  ticketTemplate: TicketTemplateConfig;
  tenantTaxMode: TenantTaxMode | null;
  isOnline: boolean;
  pendingSales: PendingSaleRecord[];
  syncingPendingSaleIds: string[];
  syncingPendingSales: boolean;
  refreshPendingSalesCount: () => Promise<unknown>;
  retryPendingSale: (recordId: string) => void;
  syncPendingSales: () => void;
  /** Navegar por identificador de ruta, que es como hablan las pantallas desde siempre. */
  navigateTo: (route: AppRoute) => void;
}

export function useShell(): ShellContext {
  return useOutletContext<ShellContext>();
}
