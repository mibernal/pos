import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql } from 'kysely';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { writeAuditLog } from '../../../shared/domain/audit/write-audit-log.js';

/**
 * Resoluciones de facturación DIAN.
 *
 * La DIAN autoriza una resolución con prefijo y rango numérico y una vigencia. Cada factura
 * electrónica lleva un número de ese rango. Sin una resolución activa el comercio no puede
 * emitir, y cuando el rango se agota deja de poder facturar de golpe — por eso estos
 * endpoints exponen `remaining` y `days_until_expiry`: para que el aviso llegue antes de
 * que sea un problema, y no el día que se acaba.
 *
 * El consecutivo lo entrega el worker al emitir (`fiscal-numbering.ts`). Aquí no se toca
 * `current_number`: moverlo a mano es la forma más rápida de duplicar un número fiscal.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD');

const createResolutionSchema = z
  .object({
    branch_id: z.string().uuid().nullable().optional(),
    document_type: z.enum(['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE']).default('INVOICE'),
    resolution_number: z.string().trim().min(1).max(100),
    resolution_date: isoDate,
    prefix: z.string().trim().min(1).max(10),
    range_from: z.number().int().positive(),
    range_to: z.number().int().positive(),
    valid_from: isoDate,
    valid_until: isoDate,
    alert_threshold: z.number().int().nonnegative().max(1_000_000).default(500),
    technical_key: z.string().trim().min(1).nullable().optional(),
    // Número ya usado de este rango antes de cargar la resolución en el sistema. Sirve para
    // migrar un comercio que venía facturando con otra herramienta sin repetir números.
    start_at: z.number().int().positive().optional()
  })
  .superRefine((value, ctx) => {
    if (value.range_to < value.range_from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['range_to'],
        message: 'El final del rango no puede ser menor que el inicio'
      });
    }
    if (value.valid_until < value.valid_from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valid_until'],
        message: 'La vigencia no puede terminar antes de empezar'
      });
    }
    if (value.start_at !== undefined) {
      if (value.start_at < value.range_from || value.start_at > value.range_to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['start_at'],
          message: 'El número inicial debe estar dentro del rango autorizado'
        });
      }
    }
  });

const resolutionResponseSchema = z.object({
  id: z.string().uuid(),
  branch_id: z.string().uuid().nullable(),
  document_type: z.string(),
  resolution_number: z.string(),
  resolution_date: z.string(),
  prefix: z.string(),
  range_from: z.number(),
  range_to: z.number(),
  current_number: z.number(),
  next_number: z.number(),
  remaining: z.number(),
  valid_from: z.string(),
  valid_until: z.string(),
  days_until_expiry: z.number(),
  alert_threshold: z.number(),
  is_active: z.boolean(),
  /** `OK`, `LOW_RANGE`, `EXPIRING`, `EXHAUSTED` o `EXPIRED`: el estado que hay que mirar. */
  health: z.string()
});

interface ResolutionRow {
  id: string;
  branch_id: string | null;
  document_type: string;
  resolution_number: string;
  resolution_date: string;
  prefix: string;
  range_from: string;
  range_to: string;
  current_number: string;
  valid_from: string;
  valid_until: string;
  alert_threshold: number;
  is_active: boolean;
}

const SELECT_COLUMNS = `id, branch_id, document_type, resolution_number,
  resolution_date::text AS resolution_date, prefix, range_from, range_to, current_number,
  valid_from::text AS valid_from, valid_until::text AS valid_until, alert_threshold, is_active`;

function daysUntil(dateText: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((new Date(`${dateText}T00:00:00Z`).getTime() - today.getTime()) / 86_400_000);
}

function present(row: ResolutionRow) {
  const rangeTo = Number(row.range_to);
  const current = Number(row.current_number);
  const remaining = rangeTo - current;
  const daysUntilExpiry = daysUntil(row.valid_until);

  // El orden importa: agotada o vencida son estados que ya bloquean la emisión; los otros
  // dos son avisos con tiempo para reaccionar.
  const health =
    remaining <= 0
      ? 'EXHAUSTED'
      : daysUntilExpiry < 0
        ? 'EXPIRED'
        : remaining <= row.alert_threshold
          ? 'LOW_RANGE'
          : daysUntilExpiry <= 30
            ? 'EXPIRING'
            : 'OK';

  return {
    id: row.id,
    branch_id: row.branch_id,
    document_type: row.document_type,
    resolution_number: row.resolution_number,
    resolution_date: row.resolution_date,
    prefix: row.prefix,
    range_from: Number(row.range_from),
    range_to: rangeTo,
    current_number: current,
    next_number: current + 1,
    remaining,
    valid_from: row.valid_from,
    valid_until: row.valid_until,
    days_until_expiry: daysUntilExpiry,
    alert_threshold: row.alert_threshold,
    is_active: row.is_active,
    health
  };
}

export const dianResolutionsRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/dian/resolutions',
    {
      preHandler: [app.requirePermissions(['settings:manage'])],
      schema: {
        summary: 'Listar resoluciones de facturación del comercio',
        tags: ['fiscal'],
        security: [{ bearerAuth: [] }],
        response: { 200: z.array(resolutionResponseSchema) }
      }
    },
    async (request, reply) => {
      // Las fechas se piden como texto a propósito: el driver devuelve `date` como `Date`
      // en la zona horaria del proceso, y eso desplaza un día la vigencia según dónde corra
      // el servidor. Una resolución que vence «mañana» según el servidor y «hoy» según el
      // comercio es un problema que aparece a las 7 p. m. de un viernes.
      const rows = await request.executeAsTenant(async (trx) => {
        const result = await sql<ResolutionRow>`
          SELECT ${sql.raw(SELECT_COLUMNS)} FROM dian_resolutions
          WHERE tenant_id = ${request.auth!.tenantId!}
          ORDER BY is_active DESC, created_at DESC
        `.execute(trx);
        return result.rows;
      });

      return reply.send(rows.map(present));
    }
  );

  typedApp.post(
    '/dian/resolutions',
    {
      preHandler: [app.requirePermissions(['settings:manage'])],
      schema: {
        summary: 'Cargar una resolución de facturación autorizada por la DIAN',
        tags: ['fiscal'],
        security: [{ bearerAuth: [] }],
        body: createResolutionSchema,
        response: { 201: resolutionResponseSchema }
      }
    },
    async (request, reply) => {
      const payload = request.body;
      const tenantId = request.auth!.tenantId!;
      const id = randomUUID();

      const created = await request.executeAsTenant(async (trx) => {
        // Cargar una resolución nueva desactiva la anterior del mismo alcance. Dos activas
        // producirían dos series de numeración en paralelo, que es exactamente el desastre
        // que el índice único de la migración 090 impide — aquí se hace explícito para dar
        // un error entendible en vez de una violación de índice.
        await sql`
          UPDATE dian_resolutions
          SET is_active = false, updated_at = NOW()
          WHERE tenant_id = ${tenantId}
            AND document_type = ${payload.document_type}
            AND is_active
            AND COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = COALESCE(${payload.branch_id ?? null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        `.execute(trx);

        // `current_number` arranca en `range_from - 1` para que el primer documento se lleve
        // `range_from`; con `start_at` se arranca donde diga el comercio.
        const startingCurrent = (payload.start_at ?? payload.range_from) - 1;

        const result = await sql<ResolutionRow>`
          INSERT INTO dian_resolutions (
            id, tenant_id, branch_id, document_type, resolution_number, resolution_date,
            prefix, range_from, range_to, current_number, valid_from, valid_until,
            alert_threshold, technical_key, is_active
          ) VALUES (
            ${id}, ${tenantId}, ${payload.branch_id ?? null}, ${payload.document_type},
            ${payload.resolution_number}, ${payload.resolution_date}::date,
            ${payload.prefix}, ${payload.range_from}, ${payload.range_to}, ${startingCurrent},
            ${payload.valid_from}::date, ${payload.valid_until}::date,
            ${payload.alert_threshold}, ${payload.technical_key ?? null}, true
          )
          RETURNING ${sql.raw(SELECT_COLUMNS)}
        `.execute(trx);

        await writeAuditLog(trx, {
          tenantId,
          userId: request.auth!.userId,
          entityType: 'DIAN_RESOLUTION',
          entityId: id,
          action: 'DIAN_RESOLUTION_CREATED',
          payloadJson: {
            current: {
              prefix: payload.prefix,
              resolution_number: payload.resolution_number,
              range_from: payload.range_from,
              range_to: payload.range_to,
              valid_until: payload.valid_until
            }
          }
        });

        return result.rows[0]!;
      });

      return reply.status(201).send(present(created));
    }
  );

  typedApp.patch(
    '/dian/resolutions/:id',
    {
      preHandler: [app.requirePermissions(['settings:manage'])],
      schema: {
        summary: 'Activar o desactivar una resolución',
        tags: ['fiscal'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          is_active: z.boolean().optional(),
          alert_threshold: z.number().int().nonnegative().max(1_000_000).optional()
        }),
        response: { 200: resolutionResponseSchema }
      }
    },
    async (request, reply) => {
      const tenantId = request.auth!.tenantId!;
      const { id } = request.params;
      const { is_active, alert_threshold } = request.body;

      if (is_active === undefined && alert_threshold === undefined) {
        throw new AppError(400, 'BAD_REQUEST', 'No hay nada que actualizar');
      }

      const updated = await request.executeAsTenant(async (trx) => {
        if (is_active === true) {
          await sql`
            UPDATE dian_resolutions r
            SET is_active = false, updated_at = NOW()
            FROM dian_resolutions target
            WHERE target.id = ${id}
              AND r.tenant_id = ${tenantId}
              AND r.id <> target.id
              AND r.document_type = target.document_type
              AND r.is_active
              AND COALESCE(r.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
                = COALESCE(target.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
          `.execute(trx);
        }

        const result = await sql<ResolutionRow>`
          UPDATE dian_resolutions
          SET is_active = COALESCE(${is_active ?? null}::boolean, is_active),
              alert_threshold = COALESCE(${alert_threshold ?? null}::integer, alert_threshold),
              updated_at = NOW()
          WHERE id = ${id} AND tenant_id = ${tenantId}
          RETURNING ${sql.raw(SELECT_COLUMNS)}
        `.execute(trx);

        return result.rows[0];
      });

      if (!updated) {
        throw new AppError(404, 'NOT_FOUND', 'Resolución no encontrada');
      }

      return reply.send(present(updated));
    }
  );
};
