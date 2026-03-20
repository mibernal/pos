import { useEffect, useState } from 'react';
import type { AuthSession, TenantTaxMode } from '../lib/api';

export function useTenantTaxMode({
  api,
  session
}: {
  api: { getCurrentTenantProfile: () => Promise<{ taxMode: TenantTaxMode }> };
  session: AuthSession | null;
}) {
  const [tenantTaxMode, setTenantTaxMode] = useState<TenantTaxMode | null>(
    session?.user.taxMode ?? null
  );

  useEffect(() => {
    setTenantTaxMode(session?.user.taxMode ?? null);
  }, [session?.user.taxMode, session?.user.tenantId]);

  useEffect(() => {
    if (!session) {
      setTenantTaxMode(null);
      return;
    }

    if (session.user.role !== 'ADMIN') {
      return;
    }

    let cancelled = false;

    void api
      .getCurrentTenantProfile()
      .then((profile) => {
        if (!cancelled) {
          setTenantTaxMode(profile.taxMode);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTenantTaxMode(session.user.taxMode ?? null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, session]);

  return {
    setTenantTaxMode,
    tenantTaxMode
  };
}
