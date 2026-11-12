import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../../shared/infra/errors/app-error.js';
import { env } from '../../../../app/env.js';
import { upsertCouponSchema } from '@pos-dian/shared';
import { getRevenueMetrics } from '../../../billing/application/recurring/revenue-metrics.js';
import { RenewalEngine } from '../../../billing/application/renewal-engine.js';
import { createYearlyCounterpart } from '../../application/billing-plans/yearly-plan.use-case.js';

/**
 * Ingresos, cupones y ciclo anual, para el panel de plataforma.
 */
export const platformRevenueRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/platform/revenue',
    { schema: { tags: ['platform', 'billing'], summary: 'MRR, churn e ingreso por plan', security: [{ bearerAuth: [] }] } },
    async () => ({ metrics: await getRevenueMetrics(app.db) })
  );

  /* ---------------- Cupones ---------------- */

  typedApp.get(
    '/platform/coupons',
    { schema: { tags: ['platform', 'billing'], security: [{ bearerAuth: [] }] } },
    async () => {
      const coupons = await app.db
        .selectFrom('billing_coupons')
        .selectAll()
        .orderBy('created_at', 'desc')
        .execute();

      return {
        coupons: coupons.map((coupon) => ({
          ...coupon,
          value: Number(coupon.value),
          valid_from: coupon.valid_from?.toISOString() ?? null,
          valid_until: coupon.valid_until?.toISOString() ?? null
        }))
      };
    }
  );

  typedApp.post(
    '/platform/coupons',
    { schema: { tags: ['platform', 'billing'], security: [{ bearerAuth: [] }], body: upsertCouponSchema } },
    async (request, reply) => {
      const body = upsertCouponSchema.parse(request.body);

      if (body.type === 'PERCENT' && body.value > 100) {
        throw new AppError(400, 'COUPON_INVALID', 'Un descuento porcentual no puede pasar de 100');
      }

      // `REPEATING` sin número de periodos es un `FOREVER` disfrazado, y disfrazado es peor:
      // nadie lo revisa porque parece temporal.
      if (body.duration === 'REPEATING' && !body.duration_periods) {
        throw new AppError(400, 'COUPON_INVALID', 'Un cupón repetido necesita cuántos periodos dura');
      }

      const existing = await app.db
        .selectFrom('billing_coupons')
        .select('code')
        .where('code', '=', body.code)
        .executeTakeFirst();

      if (existing) throw new AppError(409, 'COUPON_EXISTS', 'Ya existe un cupón con ese código');

      await app.db
        .insertInto('billing_coupons')
        .values({
          code: body.code,
          description: body.description ?? null,
          type: body.type,
          value: body.value,
          duration: body.duration,
          duration_periods: body.duration_periods ?? null,
          max_redemptions: body.max_redemptions ?? null,
          valid_from: body.valid_from ? new Date(body.valid_from) : null,
          valid_until: body.valid_until ? new Date(body.valid_until) : null,
          active: body.active
        })
        .execute();

      return reply.code(201).send({ code: body.code });
    }
  );

  typedApp.patch(
    '/platform/coupons/:code',
    {
      schema: {
        tags: ['platform', 'billing'],
        security: [{ bearerAuth: [] }],
        params: z.object({ code: z.string() }),
        body: z.object({ active: z.boolean().optional(), valid_until: z.string().datetime().nullable().optional() })
      }
    },
    async (request) => {
      const updated = await app.db
        .updateTable('billing_coupons')
        .set({
          ...(request.body.active !== undefined ? { active: request.body.active } : {}),
          ...(request.body.valid_until !== undefined
            ? { valid_until: request.body.valid_until ? new Date(request.body.valid_until) : null }
            : {})
        })
        .where('code', '=', request.params.code)
        .executeTakeFirst();

      if (Number(updated.numUpdatedRows) === 0) {
        throw new AppError(404, 'COUPON_NOT_FOUND', 'El cupón no existe');
      }

      return { code: request.params.code };
    }
  );

  /* ---------------- Ciclo anual ---------------- */

  /**
   * Crea el plan anual equivalente a uno mensual, con el descuento configurado, y le copia
   * límites y módulos.
   *
   * El ciclo anual es una fila de `billing_plans` con `billing_cycle = 'YEARLY'`, no un
   * cálculo en tiempo de cobro: así el precio anual se puede negociar por separado y el
   * histórico de facturas dice exactamente qué se cobró.
   */
  typedApp.post(
    '/platform/plans/:id/yearly',
    {
      schema: {
        tags: ['platform', 'billing'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string() }),
        body: z
          .object({
            discount_percent: z.number().min(0).max(90).optional(),
            price_cents: z.number().int().positive().optional()
          })
          .optional()
      }
    },
    async (request, reply) => {
      const body = request.body ?? {};

      const plan = await createYearlyCounterpart(app.db, {
        sourcePlanId: request.params.id,
        discountPercent: body.discount_percent ?? env.BILLING_YEARLY_DISCOUNT_PERCENT,
        priceCents: body.price_cents
      });

      // No se invalida ninguna caché: el plan anual nace sin comercios encima, así que no
      // cambia lo que ve nadie hasta que alguien se cambie a él —y ese cambio ya invalida.
      return reply.code(201).send({ plan });
    }
  );

  /* ---------------- Motor de cobro ---------------- */

  /**
   * Dispara el ciclo de cobro a mano.
   *
   * Existe para dos cosas: ensayar la secuencia completa con el reloj adelantado antes de
   * salir a producción, y no tener que esperar al scheduler cuando algo se atascó. Solo lo
   * puede llamar el dueño de la plataforma.
   */
  typedApp.post(
    '/platform/billing/run-engine',
    {
      schema: {
        tags: ['platform', 'billing'],
        security: [{ bearerAuth: [] }],
        body: z
          .object({
            /** Fecha simulada, en ISO. Solo fuera de producción: adelantar el reloj en
             *  producción cobraría periodos que todavía no han transcurrido. */
            as_of: z.string().datetime().optional()
          })
          .optional()
      }
    },
    async (request) => {
      const asOf = request.body?.as_of;

      if (asOf && env.NODE_ENV === 'production') {
        throw new AppError(400, 'CLOCK_OVERRIDE_FORBIDDEN', 'No se puede adelantar el reloj en producción');
      }

      const results = await RenewalEngine.runAll(app.db, {
        redis: app.redis,
        now: asOf ? () => new Date(asOf) : undefined
      });

      return { results };
    }
  );
};
