import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { type AuthSession } from '../lib/api';
import { readTicketTemplate, writeTicketTemplate, type TicketTemplateConfig } from '../lib/ticket-template';
import type { PosContext } from '../lib/session';
import { useApi } from '../features/auth';
import { settingsKeys } from '../shared/query-keys';

const DEFAULT_TICKET_TEMPLATE: TicketTemplateConfig = {
  businessName: 'POS DIAN',
  nit: 'N/A',
  address: 'Dirección no configurada',
  phone: '',
  footerMessage: '',
  logoUrl: '',
  printerWidth: '80mm'
};

/**
 * La plantilla del ticket: primero la del navegador, luego la del servidor.
 *
 * El orden importa. El encabezado del tiquete se imprime en cada venta, así que no puede
 * depender de que una petición termine: se pinta con lo último que se guardó en este
 * navegador y se corrige cuando llega el perfil. Si el perfil no llega, la caja sigue
 * imprimiendo con datos viejos en vez de no imprimir.
 *
 * El logo y el ancho de la impresora no se tocan: son del equipo, no del comercio, y el
 * servidor no los conoce.
 */
export function useTicketTemplate({
  posContext,
  session
}: {
  posContext: PosContext | null;
  session: AuthSession | null;
}) {
  const api = useApi();
  const [guardadaAMano, setGuardadaAMano] = useState<TicketTemplateConfig | null>(null);

  const almacenada = useMemo(() => {
    if (!session || !posContext) return null;
    return readTicketTemplate(session.user.tenantId!, {
      branchName: posContext.branchName,
      branchAddress: posContext.branchAddress
    });
  }, [posContext, session]);

  const perfil = useQuery({
    queryKey: settingsKeys.tenantProfile(session?.user.tenantId),
    queryFn: () => api.getCurrentTenantProfile(),
    enabled: Boolean(session && posContext)
  });

  const ticketTemplate = useMemo(() => {
    if (!session || !posContext || !almacenada) return DEFAULT_TICKET_TEMPLATE;
    if (guardadaAMano) return guardadaAMano;
    if (!perfil.data) return almacenada;

    // `writeTicketTemplate` persiste además de fusionar: al volver el perfil, este
    // navegador queda con los datos buenos para el próximo arranque, incluso sin red.
    return writeTicketTemplate(session.user.tenantId!, {
      businessName: perfil.data.businessName,
      nit: perfil.data.nit,
      address: perfil.data.address,
      phone: perfil.data.phone ?? '',
      footerMessage: perfil.data.footerMessage ?? '',
      logoUrl: almacenada.logoUrl,
      printerWidth: almacenada.printerWidth,
      businessType: perfil.data.businessType ?? 'OTHER',
      customBusinessType: perfil.data.customBusinessType ?? undefined
    });
  }, [almacenada, guardadaAMano, perfil.data, posContext, session]);

  const saveTicketTemplate = useCallback(
    (template: TicketTemplateConfig) => {
      if (!session) return;
      setGuardadaAMano(writeTicketTemplate(session.user.tenantId!, template));
    },
    [session]
  );

  return {
    ticketTemplate,
    saveTicketTemplate
  };
}
