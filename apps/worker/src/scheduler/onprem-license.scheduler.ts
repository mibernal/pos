import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { evaluarLicencia, type EstadoLicencia } from '../domain/licencia.js';
import { logWorkerError, logWorkerInfo } from '../infra/logging/worker-log.js';

/**
 * Sincroniza la suscripción del comercio con su archivo de licencia (solo `onprem`).
 *
 * La regla es la misma que en la nube: **la caja nunca se apaga**.
 *  - Licencia vigente → `ACTIVE`, con el plan que dice la licencia.
 *  - Vencida → `PAST_DUE`: se sigue vendiendo, cobrando y facturando; se apaga el
 *    backoffice (informes, catálogo, usuarios). Ver `DEGRADED_DENIED_PERMISSIONS`.
 *  - Ausente o inválida → igual, pero solo cuando termina el periodo que ya tenía.
 *
 * Nunca se pasa a `SUSPENDED`: eso bloquearía el punto de venta de un comercio que, en el
 * peor caso, se olvidó de copiar el archivo nuevo.
 */
const ENTITLEMENTS_CACHE_PREFIX = 'entitlements:v1:';

export async function syncOnPremLicense(pool: Pool): Promise<EstadoLicencia | null> {
  const tenants = await pool.query<{ id: string; nit: string }>(`SELECT id, nit FROM tenants ORDER BY created_at ASC`);

  if (tenants.rowCount === 0) return null;
  if (tenants.rowCount! > 1) {
    logWorkerError({
      event: 'onprem_license_multiple_tenants',
      message: 'Una instalación local debe tener un solo comercio; la licencia se aplica al primero',
      error: new Error(`tenants=${tenants.rowCount}`)
    });
  }

  const tenant = tenants.rows[0]!;

  let estado: EstadoLicencia;
  if (!env.ONPREM_LICENSE_PUBLIC_KEY) {
    estado = { estado: 'INVALIDA', motivo: 'ONPREM_LICENSE_PUBLIC_KEY no está configurada' };
  } else {
    try {
      const contenido = await readFile(env.ONPREM_LICENSE_FILE, 'utf8');
      estado = evaluarLicencia(contenido, env.ONPREM_LICENSE_PUBLIC_KEY, tenant.nit);
    } catch {
      estado = { estado: 'INVALIDA', motivo: `No se encontró el archivo de licencia en ${env.ONPREM_LICENSE_FILE}` };
    }
  }

  const plan = estado.estado === 'INVALIDA' ? null : estado.payload.plan;
  const hasta = estado.estado === 'INVALIDA' ? null : new Date(estado.payload.hasta);

  const client = await pool.connect();
  let cambio = false;
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);

    /**
     * Vigente → ACTIVE. Vencida → PAST_DUE. Inválida o ausente → PAST_DUE **solo si el
     * periodo ya pagado terminó**: recién instalado, el comercio arranca con unos días de
     * cortesía (`provision-tenant`) mientras se copia el archivo, y un archivo dañado no
     * debe quitarle lo que ya tenía pagado hasta su fecha.
     */
    const resultado = await client.query(
      `WITH objetivo AS (
         SELECT id, status, plan_id, expires_at,
                CASE
                  WHEN $2::text = 'VIGENTE' THEN 'ACTIVE'
                  WHEN $2::text = 'VENCIDA' THEN 'PAST_DUE'
                  WHEN expires_at > now() AND status IN ('ACTIVE', 'TRIAL') THEN status
                  ELSE 'PAST_DUE'
                END AS nuevo_status
           FROM tenant_subscriptions
          WHERE tenant_id = $1 AND status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED')
          ORDER BY created_at DESC
          LIMIT 1
       )
       UPDATE tenant_subscriptions ts
          SET status = o.nuevo_status,
              plan_id = COALESCE($3::varchar, ts.plan_id),
              current_period_end = COALESCE($4::timestamptz, ts.current_period_end),
              expires_at = COALESCE($4::timestamptz, ts.expires_at),
              auto_renew = false,
              updated_at = now()
         FROM objetivo o
        WHERE ts.id = o.id
          AND (o.status IS DISTINCT FROM o.nuevo_status
               OR ($3::varchar IS NOT NULL AND o.plan_id IS DISTINCT FROM $3::varchar)
               OR ($4::timestamptz IS NOT NULL AND o.expires_at IS DISTINCT FROM $4::timestamptz))`,
      [tenant.id, estado.estado, plan, hasta]
    );
    cambio = (resultado.rowCount ?? 0) > 0;

    // `tenants.status` también bloquea el login si quedó en SUSPENDED: se repone.
    await client.query(`UPDATE tenants SET status = 'ACTIVE' WHERE id = $1 AND status <> 'ACTIVE'`, [tenant.id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (cambio) {
    const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
    try {
      await redis.connect();
      await redis.del(`${ENTITLEMENTS_CACHE_PREFIX}${tenant.id}`);
    } catch {
      // La caché caduca sola en cinco minutos.
    } finally {
      redis.disconnect();
    }
  }

  const detalle =
    estado.estado === 'VIGENTE'
      ? { estado: estado.estado, plan, hasta: estado.payload.hasta, dias_restantes: estado.diasRestantes }
      : estado.estado === 'VENCIDA'
        ? { estado: estado.estado, plan, hasta: estado.payload.hasta, dias_vencida: estado.diasVencida }
        : { estado: estado.estado, motivo: estado.motivo };

  if (estado.estado === 'VIGENTE') {
    logWorkerInfo({ event: 'onprem_license_ok', message: 'Licencia vigente', details: { ...detalle, cambio } });
  } else {
    logWorkerError({
      event: 'onprem_license_degraded',
      message: 'Licencia no vigente: el backoffice queda degradado; la caja sigue operando',
      error: new Error(JSON.stringify(detalle))
    });
  }

  return estado;
}
