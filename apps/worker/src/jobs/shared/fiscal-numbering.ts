import type { Pool, PoolClient } from 'pg';

/**
 * Asignación del número fiscal de un documento DIAN.
 *
 * En Colombia la DIAN autoriza una resolución con prefijo y rango numérico, y cada
 * documento electrónico debe llevar un número de ese rango: consecutivo, sin huecos y sin
 * repetir. El CUFE/CUDE se calcula sobre él.
 *
 * Tres decisiones que conviene entender antes de tocar este archivo:
 *
 * 1. **El número se asigna en el momento de emitir, no al crear la venta.** Una venta que
 *    nunca llega a emitirse —anulada antes de que el worker la procese, por ejemplo— no
 *    debe quemar un número. Un hueco en la numeración hay que justificarlo ante la DIAN.
 *
 * 2. **Se persiste en el documento y se reutiliza en los reintentos.** El worker reintenta
 *    con backoff; si cada intento pidiera un número nuevo, un PAC lento generaría una
 *    ristra de números quemados. `assignDocumentNumber` es idempotente por documento.
 *
 * 3. **La reserva es un `UPDATE ... RETURNING` sobre la fila de la resolución.** Ese UPDATE
 *    toma un lock de fila hasta el commit, así que dos workers concurrentes se serializan
 *    solos: el segundo espera y obtiene el siguiente número. No hace falta un lock de
 *    asesoría ni una secuencia aparte, y —a diferencia de una secuencia de Postgres— esto
 *    no salta números al hacer rollback, que es justo lo que la DIAN no perdona.
 */

export class FiscalNumberingError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NO_ACTIVE_RESOLUTION'
      | 'RESOLUTION_EXPIRED'
      | 'RESOLUTION_EXHAUSTED'
      | 'RESOLUTION_NOT_YET_VALID'
  ) {
    super(message);
    this.name = 'FiscalNumberingError';
  }
}

export interface AssignedFiscalNumber {
  resolutionId: string;
  resolutionNumber: string;
  resolutionDate: string;
  prefix: string;
  documentNumber: number;
  rangeFrom: number;
  rangeTo: number;
  validFrom: string;
  validUntil: string;
  technicalKey: string | null;
  /** Números que quedan libres en el rango después de entregar este. */
  remaining: number;
  /** Cierto cuando `remaining` cayó por debajo del umbral configurado en la resolución. */
  belowThreshold: boolean;
  /** Días que faltan para que la resolución venza. Negativo sería vencida (se rechaza antes). */
  daysUntilExpiry: number;
  /** Cierto si el documento ya tenía número: se reutiliza, no se consume otro. */
  reused: boolean;
}

interface ResolutionRow {
  id: string;
  resolution_number: string;
  resolution_date: string;
  prefix: string;
  range_from: string;
  range_to: string;
  current_number: string;
  alert_threshold: number;
  valid_from: string;
  valid_until: string;
  technical_key: string | null;
}

const RESOLUTION_COLUMNS = `id, resolution_number, resolution_date::text AS resolution_date, prefix,
  range_from, range_to, current_number, alert_threshold,
  valid_from::text AS valid_from, valid_until::text AS valid_until, technical_key`;

function describeResolution(row: ResolutionRow) {
  return {
    resolutionNumber: row.resolution_number,
    resolutionDate: row.resolution_date,
    rangeFrom: Number(row.range_from),
    rangeTo: Number(row.range_to),
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    technicalKey: row.technical_key
  };
}

interface ExistingNumberRow {
  resolution_id: string | null;
  prefix: string | null;
  document_number: string | null;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Asigna (o recupera) el número fiscal de un documento.
 *
 * Debe llamarse dentro de una transacción: el lock de fila que serializa a los workers vive
 * hasta el commit, y si la emisión falla después de reservar, el rollback devuelve el
 * número al rango en vez de dejar un hueco.
 */
export async function assignDocumentNumber(
  client: PoolClient | Pool,
  params: {
    tenantId: string;
    branchId: string | null;
    documentId: string;
    documentType: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
    now?: Date;
  }
): Promise<AssignedFiscalNumber> {
  const now = params.now ?? new Date();

  // ¿Ya tiene número? Entonces este es un reintento y se reutiliza.
  const existing = await client.query<ExistingNumberRow>(
    `SELECT resolution_id, prefix, document_number
     FROM dian_documents
     WHERE id = $1 AND tenant_id = $2`,
    [params.documentId, params.tenantId]
  );

  const current = existing.rows[0];
  if (current?.document_number != null && current.prefix != null && current.resolution_id != null) {
    const resolution = await client.query<ResolutionRow>(
      `SELECT ${RESOLUTION_COLUMNS} FROM dian_resolutions WHERE id = $1`,
      [current.resolution_id]
    );
    const row = resolution.rows[0];

    if (!row) {
      // El documento apunta a una resolución que ya no existe. Es un estado imposible salvo
      // borrado manual, y no se puede resolver adivinando: emitir con otra numeración
      // duplicaría el consecutivo.
      throw new FiscalNumberingError(
        `El documento ${params.documentId} referencia la resolución ${current.resolution_id}, que no existe.`,
        'NO_ACTIVE_RESOLUTION'
      );
    }

    const remaining = Number(row.range_to) - Number(row.current_number);

    return {
      resolutionId: current.resolution_id,
      prefix: current.prefix,
      documentNumber: Number(current.document_number),
      remaining,
      belowThreshold: remaining <= row.alert_threshold,
      daysUntilExpiry: daysBetween(now, new Date(row.valid_until)),
      reused: true,
      ...describeResolution(row)
    };
  }

  // Reserva atómica. Las condiciones del WHERE distinguen «no hay resolución» de «la hay
  // pero está agotada o vencida», para poder dar un mensaje que diga qué hacer.
  const reserved = await client.query<ResolutionRow>(
    `
      UPDATE dian_resolutions
      SET current_number = current_number + 1,
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM dian_resolutions
        WHERE tenant_id = $1
          AND document_type = $2
          AND is_active
          AND (branch_id IS NULL OR branch_id = $3)
        ORDER BY branch_id NULLS LAST
        LIMIT 1
        FOR UPDATE
      )
        AND current_number < range_to
        AND $4::date BETWEEN valid_from AND valid_until
      RETURNING ${RESOLUTION_COLUMNS}
    `,
    [params.tenantId, params.documentType, params.branchId, now.toISOString().slice(0, 10)]
  );

  const row = reserved.rows[0];

  if (!row) {
    await explainReservationFailure(client, params.tenantId, params.documentType, params.branchId, now);
    // `explainReservationFailure` siempre lanza; esto es para el verificador de tipos.
    throw new FiscalNumberingError('No fue posible asignar numeración fiscal', 'NO_ACTIVE_RESOLUTION');
  }

  const documentNumber = Number(row.current_number);
  const remaining = Number(row.range_to) - documentNumber;

  await client.query(
    `UPDATE dian_documents
     SET resolution_id = $2, prefix = $3, document_number = $4, updated_at = NOW()
     WHERE id = $1`,
    [params.documentId, row.id, row.prefix, documentNumber]
  );

  return {
    resolutionId: row.id,
    prefix: row.prefix,
    documentNumber,
    remaining,
    belowThreshold: remaining <= row.alert_threshold,
    daysUntilExpiry: daysBetween(now, new Date(row.valid_until)),
    reused: false,
    ...describeResolution(row)
  };
}

/**
 * Convierte «el UPDATE no afectó ninguna fila» en un error que dice qué pasa y qué hacer.
 * Sin esto, un comercio con la resolución vencida vería el mismo mensaje que uno que nunca
 * la configuró, y son dos problemas distintos con dos soluciones distintas.
 */
async function explainReservationFailure(
  client: PoolClient | Pool,
  tenantId: string,
  documentType: string,
  branchId: string | null,
  now: Date
): Promise<never> {
  const found = await client.query<ResolutionRow>(
    `SELECT ${RESOLUTION_COLUMNS}
     FROM dian_resolutions
     WHERE tenant_id = $1 AND document_type = $2 AND is_active
       AND (branch_id IS NULL OR branch_id = $3)
     ORDER BY branch_id NULLS LAST
     LIMIT 1`,
    [tenantId, documentType, branchId]
  );

  const row = found.rows[0];

  if (!row) {
    throw new FiscalNumberingError(
      `El comercio ${tenantId} no tiene una resolución de facturación activa para ${documentType}. ` +
        'Cárgala en Configuración DIAN antes de emitir.',
      'NO_ACTIVE_RESOLUTION'
    );
  }

  const today = now.toISOString().slice(0, 10);

  if (today > row.valid_until) {
    throw new FiscalNumberingError(
      `La resolución ${row.prefix} venció el ${row.valid_until}. Solicita una nueva a la DIAN y ` +
        'cárgala antes de seguir facturando.',
      'RESOLUTION_EXPIRED'
    );
  }

  if (today < row.valid_from) {
    throw new FiscalNumberingError(
      `La resolución ${row.prefix} empieza a regir el ${row.valid_from}.`,
      'RESOLUTION_NOT_YET_VALID'
    );
  }

  throw new FiscalNumberingError(
    `La resolución ${row.prefix} agotó su rango (${row.range_from}–${row.range_to}). ` +
      'Solicita un rango nuevo a la DIAN: el comercio no puede emitir más documentos.',
    'RESOLUTION_EXHAUSTED'
  );
}

/**
 * Publica el aviso de resolución por agotarse o por vencer.
 *
 * Va por la bandeja de salida, como el resto de notificaciones, y **después** de la
 * transacción que reservó el número: un fallo al avisar no puede impedir que se emita la
 * factura. Es la misma lección de la alerta de bajo stock (D-041).
 *
 * Se deduplica por resolución y por día: el aviso es útil una vez, no en cada venta.
 */
export async function publishResolutionAlert(
  pool: Pool,
  params: {
    tenantId: string;
    branchId: string | null;
    resolutionId: string;
    prefix: string;
    remaining: number;
    daysUntilExpiry: number;
  }
): Promise<void> {
  try {
    const alreadySentToday = await pool.query(
      `SELECT 1 FROM outbox_events
       WHERE tenant_id = $1
         AND type = 'dian_resolution.alert'
         AND aggregate_id = $2::uuid
         AND created_at >= date_trunc('day', NOW())
       LIMIT 1`,
      [params.tenantId, params.resolutionId]
    );

    if (alreadySentToday.rows.length > 0) return;

    await pool.query(
      `INSERT INTO outbox_events
         (id, tenant_id, type, aggregate_type, aggregate_id, branch_id, payload_json, status)
       VALUES (gen_random_uuid(), $1::uuid, 'dian_resolution.alert', 'DIAN_RESOLUTION', $2::uuid, $3::uuid, $4::jsonb, 'PENDING')`,
      [
        params.tenantId,
        params.resolutionId,
        params.branchId,
        JSON.stringify({
          tenant_id: params.tenantId,
          branch_id: params.branchId,
          resolution_id: params.resolutionId,
          prefix: params.prefix,
          remaining: params.remaining,
          days_until_expiry: params.daysUntilExpiry,
          reason: params.remaining <= 0 ? 'EXHAUSTED' : params.daysUntilExpiry <= 30 ? 'EXPIRING' : 'LOW_RANGE'
        })
      ]
    );
  } catch {
    // Deliberadamente silencioso: el aviso es secundario y no puede tumbar la emisión.
  }
}
