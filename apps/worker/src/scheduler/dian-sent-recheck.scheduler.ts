/**
 * Cierre del ciclo de los documentos DIAN que quedan en `SENT`.
 *
 * La emisión es asíncrona: el PAC acusa recibo (`SENT`) y resuelve minutos u horas después.
 * Si nadie pregunta, el documento se queda en `SENT` para siempre y el comercio cree que
 * facturó cuando puede que la DIAN lo haya rechazado.
 *
 * **Qué hacía este scheduler antes, y por qué no servía.** Reencolaba el evento de la
 * bandeja de salida para que el procesador volviera a *emitir*. Pero el procesador tiene una
 * guarda de idempotencia —`getDianEmissionBlockReason`— que rechaza reemitir cualquier
 * documento ya en `SENT`: el trabajo reencolado se saltaba de inmediato, el documento
 * seguía en `SENT`, y cada ciclo dejaba una fila más en `outbox_events`. Un bucle que no
 * cerraba nada y acumulaba basura. Reemitir, además, es justo lo que no se debe hacer: el
 * PAC podría aceptar dos veces el mismo documento.
 *
 * **Lo que hace ahora.** Le *pregunta* al PAC por el estado (`queryStatus`) y aplica la
 * transición que corresponda. Si el proveedor no ofrece consulta, o responde `UNKNOWN`, el
 * documento se deja como está y —pasado `DIAN_SENT_ALERT_HOURS`— se publica una alerta,
 * porque un documento sin resolver es una contingencia fiscal que alguien tiene que mirar.
 */
import type { Pool } from 'pg';
import { buildDianProvider } from '../providers/index.js';
import { resolveDianCredentials } from '../infra/security/dian-credentials.js';
import { env } from '../config/env.js';
import { logWorkerError, logWorkerInfo } from '../infra/logging/worker-log.js';
import { planDianStatusTransition } from '../domain/dian-document-status.js';

/** Tiempo sin resolverse antes de volver a preguntar. */
const DIAN_SENT_RECHECK_DELAY_MS = parseInt(process.env.DIAN_SENT_RECHECK_DELAY_MS ?? '600000', 10);

/** Horas en `SENT` a partir de las cuales el documento deja de ser normal y se alerta. */
const DIAN_SENT_ALERT_HOURS = parseInt(process.env.DIAN_SENT_ALERT_HOURS ?? '6', 10);

interface StuckDianDocumentRow {
  id: string;
  sale_id: string;
  tenant_id: string;
  document_type: string;
  cude: string | null;
  prefix: string | null;
  document_number: string | null;
  updated_at: Date;
  hours_stuck: string;
}

export interface RecheckOutcome {
  checked: number;
  resolved: number;
  stillPending: number;
  alerted: number;
}

export async function recheckStuckDianDocuments(pool: Pool, limit = 50): Promise<RecheckOutcome> {
  const recheckCutoff = new Date(Date.now() - DIAN_SENT_RECHECK_DELAY_MS);

  const { rows: stuckDocs } = await pool.query<StuckDianDocumentRow>(
    `
      SELECT d.id, d.sale_id, d.tenant_id, d.document_type, d.cude, d.prefix,
             d.document_number::text AS document_number, d.updated_at,
             EXTRACT(EPOCH FROM (NOW() - d.updated_at)) / 3600 AS hours_stuck
      FROM dian_documents d
      WHERE d.status = 'SENT'
        AND d.updated_at <= $1
      ORDER BY d.updated_at ASC
      LIMIT $2
    `,
    [recheckCutoff, limit]
  );

  const outcome: RecheckOutcome = { checked: 0, resolved: 0, stillPending: 0, alerted: 0 };
  if (stuckDocs.length === 0) return outcome;

  logWorkerInfo({
    event: 'dian_sent_recheck_found',
    message: `Encontrados ${stuckDocs.length} documentos DIAN sin resolver`,
    details: { recheck_cutoff: recheckCutoff.toISOString(), count: stuckDocs.length }
  });

  for (const doc of stuckDocs) {
    outcome.checked += 1;
    const hoursStuck = Number(doc.hours_stuck);

    try {
      const provider = await buildProviderForTenant(pool, doc.tenant_id);

      if (!provider?.queryStatus) {
        // Sin consulta de estado, el cierre depende del webhook del PAC. Lo único que se
        // puede hacer es avisar para que alguien lo mire.
        outcome.stillPending += 1;
        if (await maybeAlert(pool, doc, hoursStuck, 'PROVIDER_HAS_NO_STATUS_QUERY')) outcome.alerted += 1;
        continue;
      }

      const result = await provider.queryStatus({
        tenant_id: doc.tenant_id,
        document_id: doc.id,
        cude: doc.cude,
        prefix: doc.prefix,
        document_number: doc.document_number == null ? null : Number(doc.document_number)
      });

      if (result.status === 'UNKNOWN' || result.status === 'SENT') {
        outcome.stillPending += 1;
        if (await maybeAlert(pool, doc, hoursStuck, `STILL_${result.status}`)) outcome.alerted += 1;
        continue;
      }

      const plan = planDianStatusTransition('SENT', result.status);

      await pool.query(
        `UPDATE dian_documents
         SET status = $2,
             cude = COALESCE($3, cude),
             provider_response_json = $4::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [doc.id, plan.finalStatus, result.cude, JSON.stringify(result.raw)]
      );

      outcome.resolved += 1;

      logWorkerInfo({
        event: 'dian_sent_recheck_resolved',
        message: 'Documento DIAN resuelto por consulta al PAC',
        tenant_id: doc.tenant_id,
        sale_id: doc.sale_id,
        dian_document_id: doc.id,
        provider_result: result.status,
        details: { final_dian_status: plan.finalStatus, hours_stuck: Math.round(hoursStuck), cude: result.cude }
      });
    } catch (error) {
      outcome.stillPending += 1;
      logWorkerError({
        event: 'dian_sent_recheck_failed',
        message: 'Error al consultar el estado del documento DIAN',
        error,
        tenant_id: doc.tenant_id,
        sale_id: doc.sale_id,
        details: { dian_document_id: doc.id }
      });
      if (await maybeAlert(pool, doc, hoursStuck, 'QUERY_FAILED')) outcome.alerted += 1;
    }
  }

  logWorkerInfo({
    event: 'dian_sent_recheck_completed',
    message: 'Ciclo de reconsulta DIAN terminado',
    details: { ...outcome }
  });

  return outcome;
}

async function buildProviderForTenant(pool: Pool, tenantId: string) {
  const { rows } = await pool.query<{ provider_name: string; credentials: unknown; test_mode: boolean }>(
    `SELECT provider_name, credentials, test_mode FROM tenant_dian_settings WHERE tenant_id = $1`,
    [tenantId]
  );

  const config = rows[0];
  if (!config) return null;

  return buildDianProvider({
    provider_name: config.provider_name,
    credentials: resolveDianCredentials(config.credentials, {
      tenantId,
      isProduction: env.NODE_ENV === 'production',
      encryptionKey: env.CREDENTIALS_ENCRYPTION_KEY
    }),
    test_mode: config.test_mode
  });
}

/**
 * Publica la alerta de documento sin resolver, una vez por documento y día.
 *
 * Sin la deduplicación, un documento atascado generaría una alerta cada diez minutos hasta
 * que alguien lo mirara — y una bandeja con doscientas alertas iguales es una bandeja que
 * nadie mira. Devuelve `true` si publicó.
 */
async function maybeAlert(
  pool: Pool,
  doc: StuckDianDocumentRow,
  hoursStuck: number,
  reason: string
): Promise<boolean> {
  if (hoursStuck < DIAN_SENT_ALERT_HOURS) return false;

  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM outbox_events
       WHERE tenant_id = $1 AND type = 'dian_document.unresolved'
         AND aggregate_id = $2::uuid AND created_at >= date_trunc('day', NOW())
       LIMIT 1`,
      [doc.tenant_id, doc.id]
    );
    if (rows.length > 0) return false;

    await pool.query(
      `INSERT INTO outbox_events
         (id, tenant_id, type, aggregate_type, aggregate_id, payload_json, status)
       VALUES (gen_random_uuid(), $1::uuid, 'dian_document.unresolved', 'DIAN_DOCUMENT', $2::uuid, $3::jsonb, 'PENDING')`,
      [
        doc.tenant_id,
        doc.id,
        JSON.stringify({
          tenant_id: doc.tenant_id,
          dian_document_id: doc.id,
          sale_id: doc.sale_id,
          document_type: doc.document_type,
          full_number: doc.prefix && doc.document_number ? `${doc.prefix}${doc.document_number}` : null,
          hours_stuck: Math.round(hoursStuck),
          reason
        })
      ]
    );

    logWorkerInfo({
      event: 'dian_document_unresolved_alert',
      message: `Documento DIAN lleva ${Math.round(hoursStuck)} h sin resolverse`,
      tenant_id: doc.tenant_id,
      sale_id: doc.sale_id,
      details: { dian_document_id: doc.id, reason }
    });

    return true;
  } catch {
    // La alerta es secundaria: nunca puede tumbar el ciclo de reconsulta.
    return false;
  }
}
