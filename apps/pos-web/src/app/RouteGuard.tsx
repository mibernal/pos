import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '../features/auth';
import { useModules } from '../features/modules';
import { ShellMessage } from '../components/ui';
import { APP_ROUTE_DEFINITIONS, routeAccess } from './routes';
import type { AppRoute } from '../types';
import { usePosStore } from '../hooks/usePosStore';

/**
 * La guarda sale de la definición de la ruta, no de cada pantalla.
 *
 * Antes cada pantalla se protegía dos veces —una para decidir si aparecía en el menú y otra
 * al renderizarla— y las dos copias divergieron: el menú escondía el KDS a quien no tuviera
 * `kitchen_display`, mientras la pantalla solo exigía `kitchen`. Aquí se lee una sola vez.
 *
 * Un permiso que falta responde con un mensaje y no con una redirección: alguien que llega
 * por una URL guardada tiene que entender por qué no ve nada, y una redirección silenciosa
 * parece un fallo. Lo que sí redirige es la falta de contexto de caja, porque eso no es una
 * negativa: es que todavía no eligió sucursal.
 */
export function RouteGuard({ route, children }: { route: AppRoute; children: ReactNode }) {
  const { session } = useSession();
  const { hasModule } = useModules();
  const posContext = usePosStore((state) => state.posContext);

  const definicion = APP_ROUTE_DEFINITIONS.find((r) => r.id === route);
  if (!definicion) return <Navigate to="/" replace />;

  const acceso = routeAccess(definicion, session?.user ?? null, hasModule);

  if (acceso === 'missing-module') {
    return (
      <ShellMessage
        title={`«${definicion.label}» no está en tu plan`}
        subtitle="Puedes activarlo desde Facturación / Plan."
      />
    );
  }

  if (acceso === 'missing-permission') {
    return (
      <ShellMessage
        title="No tienes acceso a esta pantalla"
        subtitle={`«${definicion.label}» requiere un permiso que tu usuario no tiene. Pídeselo a quien administre el comercio.`}
      />
    );
  }

  if (definicion.requiresPosContext && !posContext) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
