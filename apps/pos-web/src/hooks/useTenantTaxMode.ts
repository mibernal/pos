import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AuthSession, TenantTaxMode } from '../lib/api';
import { useApi } from '../features/auth';
import { settingsKeys } from '../shared/query-keys';

/**
 * El régimen de IVA del comercio.
 *
 * Viene firmado en el token, pero puede haber cambiado desde que se firmó, así que se
 * confirma contra el perfil. El token es el valor de partida y el que queda si la consulta
 * falla: es preferible cobrar con un régimen quizá viejo que con ninguno.
 *
 * Solo lo consultan los roles que pueden leer el perfil del comercio; para el resto, el
 * token es la única fuente y la consulta ni se lanza.
 */
export function useTenantTaxMode({ session }: { session: AuthSession | null }) {
  const api = useApi();

  const puedeLeerPerfil = session?.user.role === 'ADMIN' || session?.user.role === 'TENANT_OWNER';

  const perfil = useQuery({
    queryKey: settingsKeys.tenantProfile(session?.user.tenantId),
    queryFn: () => api.getCurrentTenantProfile(),
    enabled: Boolean(session) && puedeLeerPerfil
  });

  // Quien acaba de guardar el perfil ya sabe el régimen nuevo y lo impone sin esperar a
  // que la consulta se revalide.
  const [impuesto, setImpuesto] = useState<TenantTaxMode | null>(null);

  const tenantTaxMode: TenantTaxMode | null = session
    ? impuesto ?? perfil.data?.taxMode ?? session.user.taxMode ?? null
    : null;

  return {
    setTenantTaxMode: setImpuesto,
    tenantTaxMode
  };
}
