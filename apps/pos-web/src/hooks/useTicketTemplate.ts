import { useCallback, useEffect, useState } from 'react';
import { type AuthSession, type createApiClient } from '../lib/api';
import { readTicketTemplate, writeTicketTemplate, type TicketTemplateConfig } from '../lib/ticket-template';
import type { PosContext } from '../lib/session';

const DEFAULT_TICKET_TEMPLATE: TicketTemplateConfig = {
  businessName: 'POS DIAN',
  nit: 'N/A',
  address: 'Dirección no configurada',
  phone: '',
  footerMessage: '',
  logoUrl: '',
  printerWidth: '80mm'
};

export function useTicketTemplate({
  api,
  posContext,
  session
}: {
  api: ReturnType<typeof createApiClient>;
  posContext: PosContext | null;
  session: AuthSession | null;
}) {
  const [ticketTemplate, setTicketTemplate] = useState<TicketTemplateConfig>(DEFAULT_TICKET_TEMPLATE);

  useEffect(() => {
    if (!session || !posContext) {
      setTicketTemplate(DEFAULT_TICKET_TEMPLATE);
      return;
    }

    let cancelled = false;
    const storedTemplate = readTicketTemplate(session.user.tenantId!, {
      branchName: posContext.branchName,
      branchAddress: posContext.branchAddress
    });

    setTicketTemplate(storedTemplate);

    void api
      .getCurrentTenantProfile()
      .then((profile) => {
        if (cancelled) {
          return;
        }

        const mergedTemplate = writeTicketTemplate(session.user.tenantId!, {
          businessName: profile.businessName,
          nit: profile.nit,
          address: profile.address,
          phone: profile.phone ?? '',
          footerMessage: profile.footerMessage ?? '',
          logoUrl: storedTemplate.logoUrl,
          printerWidth: storedTemplate.printerWidth,
          businessType: profile.businessType ?? 'OTHER',
          customBusinessType: profile.customBusinessType ?? undefined
        });

        setTicketTemplate(mergedTemplate);
      })
      .catch(() => {
        if (!cancelled) {
          setTicketTemplate(storedTemplate);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, posContext, session]);

  const saveTicketTemplate = useCallback(
    (template: TicketTemplateConfig) => {
      if (!session) {
        return;
      }

      const savedTemplate = writeTicketTemplate(session.user.tenantId!, template);
      setTicketTemplate(savedTemplate);
    },
    [session]
  );

  return {
    ticketTemplate,
    saveTicketTemplate
  };
}
