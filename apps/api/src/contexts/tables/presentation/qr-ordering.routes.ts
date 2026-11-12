import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { qrOrderSchema, type QrTableView } from '@pos-dian/shared';
import type { Database } from '../../../shared/infra/db/schema.js';
import { executeAsTenant } from '../../../shared/infra/db/rls.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { modulesForTenantInTransaction } from '../../../shared/infra/entitlements/modules-in-transaction.js';
import {
  assertAndRecordIpRateLimit,
  assertAndRecordIpRateLimitSync,
  RATE_LIMIT_EXCEEDED,
  buildIpRateLimitKey
} from '../../../shared/infra/security/login-rate-limit.js';
import { TableOrdersRepository } from '../infra/table-orders.repository.js';

/**
 * Pedido desde el menú QR.
 *
 * Rutas públicas: no hay sesión, no hay usuario y sí hay escritura en la cocina. Eso obliga a
 * tres cosas que no son opcionales.
 *
 * El token de la mesa es lo único que autoriza, y por eso es aleatorio y rotable. Los precios
 * los pone el servidor: si vinieran del móvil del cliente, la carta sería una sugerencia. Y
 * hay límite por IP, porque el coste de un pedido falso no lo paga el servidor —lo paga una
 * cocina imprimiendo comandas de mesas vacías—.
 *
 * Un token que no resuelve responde 404, igual que uno cuyo comercio no tiene el módulo
 * contratado: distinguirlos convertiría la ruta en un detector de restaurantes.
 */

interface MesaResuelta {
  tenantId: string;
  branchId: string;
  branchName: string;
  tableId: string;
  tableName: string;
}

const NO_EXISTE = new AppError(404, 'QR_NOT_FOUND', 'Ese código no corresponde a ninguna mesa.');

export async function qrOrderingRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  const tableOrdersRepo = new TableOrdersRepository(app.db);

  /**
   * Dos pasos, y el orden importa.
   *
   * Primero `qr_table_tokens`, la única tabla sin RLS del recorrido, que solo sabe decir de
   * qué comercio es un token. Con eso ya se puede abrir el contexto de tenant y leer la mesa
   * como se lee todo lo demás: dentro de RLS. Así ninguna consulta con datos del negocio
   * corre sin contexto, que es la regla que sostiene el aislamiento entre comercios.
   */
  async function resolverMesa(token: string): Promise<MesaResuelta> {
    const referencia = await app.db
      .selectFrom('qr_table_tokens')
      .select(['tenant_id', 'branch_id', 'table_id'])
      .where('token', '=', token)
      .executeTakeFirst();

    if (!referencia) throw NO_EXISTE;

    return executeAsTenant(app.db, referencia.tenant_id, async (trx) => {
      const fila = await trx
        .selectFrom('tables as t')
        .innerJoin('branches as b', 'b.id', 't.branch_id')
        .select(['t.id as table_id', 't.name as table_name', 't.tenant_id', 't.branch_id', 'b.name as branch_name'])
        .where('t.id', '=', referencia.table_id)
        .where('t.is_active', '=', true)
        .executeTakeFirst();

      // Una mesa desactivada deja de responder: el código impreso sigue existiendo y ya no
      // sirve, que es justo lo que se espera al retirar una mesa del salón.
      if (!fila) throw NO_EXISTE;

      return {
        tenantId: fila.tenant_id,
        branchId: fila.branch_id,
        branchName: fila.branch_name,
        tableId: fila.table_id,
        tableName: fila.table_name
      };
    });
  }

  async function assertModulo(trx: Transaction<Database>, tenantId: string) {
    const modulos = await modulesForTenantInTransaction(trx, tenantId);
    if (!modulos.has('qr_menu')) throw NO_EXISTE;
  }

  async function limitar(ip: string, accion: string, max: number, ventanaMs: number) {
    const clave = buildIpRateLimitKey(accion, ip);
    try {
      if (app.redis) await assertAndRecordIpRateLimit(app.redis, clave, max, ventanaMs, app.log);
      else assertAndRecordIpRateLimitSync(clave, max, ventanaMs);
    } catch (err) {
      if (err instanceof Error && err.message === RATE_LIMIT_EXCEEDED) {
        throw new AppError(429, 'RATE_LIMIT_EXCEEDED', 'Demasiadas peticiones. Espera un momento.');
      }
      throw err;
    }
  }

  /** La carta de la sucursal y, si la mesa tiene cuenta abierta, lo que lleva pedido. */
  typedApp.get(
    '/public/qr/:token',
    { schema: { tags: ['Public Catalog'], params: z.object({ token: z.string().min(20).max(64) }) } },
    async (request): Promise<QrTableView> => {
      await limitar(request.ip, 'qr-view', 120, 60_000);
      const mesa = await resolverMesa(request.params.token);

      return executeAsTenant(app.db, mesa.tenantId, async (trx) => {
        await assertModulo(trx, mesa.tenantId);

        /**
         * La carta se acota a la sucursal. El catálogo público anterior filtraba solo por
         * comercio, así que el QR de un local enseñaba los platos de todos —incluidos los de
         * una cocina que no puede prepararlos—.
         */
        const productos = await trx
          .selectFrom('products')
          .select(['id', 'name', 'description', 'price_cents', 'image_url', 'category'])
          .where('tenant_id', '=', mesa.tenantId)
          .where('active', '=', true)
          .where((eb) => eb.or([eb('branch_id', '=', mesa.branchId), eb('branch_id', 'is', null)]))
          .orderBy('category')
          .orderBy('name')
          .execute();

        const porCategoria = new Map<string, QrTableView['menu'][number]['products']>();
        for (const producto of productos) {
          const lista = porCategoria.get(producto.category) ?? [];
          lista.push({
            id: producto.id,
            name: producto.name,
            description: producto.description,
            price_cents: producto.price_cents,
            image_url: producto.image_url
          });
          porCategoria.set(producto.category, lista);
        }

        const cuenta = await trx
          .selectFrom('table_orders')
          .select(['id', 'bill_requested_at'])
          .where('tenant_id', '=', mesa.tenantId)
          .where('table_id', '=', mesa.tableId)
          .where('status', '=', 'OPEN')
          .executeTakeFirst();

        let orden: QrTableView['order'] = null;

        if (cuenta) {
          const lineas = await trx
            .selectFrom('table_order_items as toi')
            .innerJoin('products as p', 'p.id', 'toi.product_id')
            .select(['p.name as product_name', 'toi.qty', 'toi.line_total_cents', 'toi.source'])
            .where('toi.table_order_id', '=', cuenta.id)
            .where('toi.item_status', '!=', 'CANCELLED')
            .orderBy('toi.created_at')
            .execute();

          orden = {
            lines: lineas.map((linea) => ({
              product_name: linea.product_name,
              qty: Number(linea.qty),
              line_total_cents: Number(linea.line_total_cents),
              source: linea.source
            })),
            total_cents: lineas.reduce((total, linea) => total + Number(linea.line_total_cents), 0),
            bill_requested: cuenta.bill_requested_at !== null
          };
        }

        return {
          branch_name: mesa.branchName,
          table_name: mesa.tableName,
          menu: [...porCategoria.entries()].map(([name, products]) => ({ name, products })),
          order: orden
        };
      });
    }
  );

  /** El comensal pide. Entra por la misma puerta que el mesero: cuenta, ronda y comanda. */
  typedApp.post(
    '/public/qr/:token/orders',
    {
      schema: {
        tags: ['Public Catalog'],
        params: z.object({ token: z.string().min(20).max(64) }),
        body: qrOrderSchema
      }
    },
    async (request, reply) => {
      await limitar(request.ip, 'qr-order', 10, 60_000);
      const mesa = await resolverMesa(request.params.token);

      await executeAsTenant(app.db, mesa.tenantId, async (trx) => {
        await assertModulo(trx, mesa.tenantId);

        /**
         * Serializa los pedidos de la misma mesa. Sin esto, dos comensales que pulsan a la
         * vez pueden crear dos cuentas abiertas para la mesa y la segunda se lleva la venta.
         */
        await sql`SELECT pg_advisory_xact_lock(hashtext(${`qr:${mesa.tenantId}`}), hashtext(${mesa.tableId}))`.execute(trx);

        const productos = await trx
          .selectFrom('products')
          .select(['id', 'price_cents'])
          .where('tenant_id', '=', mesa.tenantId)
          .where('active', '=', true)
          .where(
            'id',
            'in',
            request.body.items.map((item) => item.product_id)
          )
          .execute();

        const precios = new Map(productos.map((producto) => [producto.id, producto.price_cents]));

        for (const item of request.body.items) {
          if (!precios.has(item.product_id)) {
            throw new AppError(404, 'PRODUCT_NOT_AVAILABLE', 'Alguno de esos platos ya no está disponible.');
          }
        }

        let cuenta = await trx
          .selectFrom('table_orders')
          .select(['id'])
          .where('tenant_id', '=', mesa.tenantId)
          .where('table_id', '=', mesa.tableId)
          .where('status', '=', 'OPEN')
          .executeTakeFirst();

        if (!cuenta) {
          const nuevaId = randomUUID();
          await trx
            .insertInto('table_orders')
            .values({
              id: nuevaId,
              tenant_id: mesa.tenantId,
              branch_id: mesa.branchId,
              table_id: mesa.tableId,
              status: 'OPEN',
              order_type: 'DINE_IN'
            })
            .execute();

          await trx
            .updateTable('tables')
            .set({ status: 'OCCUPIED', current_order_id: nuevaId, status_updated_at: new Date() })
            .where('tenant_id', '=', mesa.tenantId)
            .where('id', '=', mesa.tableId)
            .execute();

          cuenta = { id: nuevaId };
        }

        await trx
          .insertInto('table_order_items')
          .values(
            request.body.items.map((item) => {
              const precio = precios.get(item.product_id) ?? 0;
              return {
                id: randomUUID(),
                tenant_id: mesa.tenantId,
                branch_id: mesa.branchId,
                table_order_id: cuenta!.id,
                product_id: item.product_id,
                variant_id: item.variant_id ?? null,
                qty: item.qty,
                price_cents: precio,
                line_total_cents: precio * item.qty,
                notes: item.notes ?? null,
                course: 1,
                item_status: 'PENDING',
                source: 'QR'
              };
            })
          )
          .execute();

        await trx
          .updateTable('table_orders')
          .set((eb) => ({
            total_cents: eb.selectFrom('table_order_items')
              .select((inner) => inner.fn.coalesce(inner.fn.sum<number>('line_total_cents'), inner.lit(0)).as('total'))
              .where('table_order_id', '=', cuenta!.id)
              .where('item_status', '!=', 'CANCELLED'),
            updated_at: new Date()
          }))
          .where('id', '=', cuenta.id)
          .execute();
      });

      /**
       * La comanda sale **después** del commit y con su propio manejo de errores. Reutiliza
       * el envío a cocina que ya calcula el delta contra lo enviado antes, así que un pedido
       * añadido a una cuenta que ya iba por la mitad no reimprime lo anterior.
       */
      try {
        await tableOrdersRepo.sendTableOrderToKitchen(mesa.tenantId, mesa.branchId, mesa.tableId);
      } catch (error) {
        request.log.error(
          { err: error, tenant_id: mesa.tenantId, table_id: mesa.tableId },
          'El pedido por QR se guardó pero no se pudo enviar a cocina'
        );
      }

      return reply.code(201).send({ ok: true });
    }
  );

  /** «La cuenta, por favor». Hasta ahora había que levantar la mano. */
  typedApp.post(
    '/public/qr/:token/bill',
    { schema: { tags: ['Public Catalog'], params: z.object({ token: z.string().min(20).max(64) }) } },
    async (request, reply) => {
      await limitar(request.ip, 'qr-bill', 10, 60_000);
      const mesa = await resolverMesa(request.params.token);

      await executeAsTenant(app.db, mesa.tenantId, async (trx) => {
        await assertModulo(trx, mesa.tenantId);

        const actualizada = await trx
          .updateTable('table_orders')
          .set({ bill_requested_at: new Date(), updated_at: new Date() })
          .where('tenant_id', '=', mesa.tenantId)
          .where('table_id', '=', mesa.tableId)
          .where('status', '=', 'OPEN')
          .where('bill_requested_at', 'is', null)
          .executeTakeFirst();

        // Pedirla dos veces no es un error: es un comensal impaciente.
        void actualizada;
      });

      return reply.send({ ok: true });
    }
  );
}

/**
 * Cara privada del QR: generar y rotar el token de una mesa.
 *
 * Rotar es la única defensa cuando un código acaba fotografiado donde no debía. El token
 * anterior deja de valer en cuanto se emite el nuevo, y lo que hay que hacer es imprimir
 * otro papel — no cambiar la mesa.
 */
export async function qrTokensRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post(
    '/tables/:id/qr-token',
    {
      preHandler: [app.requireModule(['qr_menu']), app.requirePermissions(['branches:manage'])],
      schema: {
        tags: ['tables'],
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() })
      }
    },
    async (request) =>
      request.executeAsTenant(async (trx) => {
        const tenantId = request.auth!.tenantId!;

        /**
         * La mesa se comprueba dentro de RLS antes de tocar la tabla de búsqueda, que no la
         * tiene: sin esto, un comercio podría emitir el código de una mesa ajena escribiendo
         * su identificador en la URL.
         */
        const mesa = await trx
          .selectFrom('tables')
          .select(['id', 'name', 'branch_id'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', request.params.id)
          .executeTakeFirst();

        if (!mesa) {
          throw new AppError(404, 'TABLE_NOT_FOUND', 'Esa mesa no existe.');
        }

        // 32 bytes en base64url: no se adivina, y cabe en un QR sin hacerlo ilegible.
        const token = randomBytes(32).toString('base64url');

        // Una mesa, un código vivo: emitir uno nuevo invalida el anterior.
        await trx
          .insertInto('qr_table_tokens')
          .values({ token, tenant_id: tenantId, branch_id: mesa.branch_id, table_id: mesa.id })
          .onConflict((oc) =>
            oc.column('table_id').doUpdateSet({ token, created_at: new Date() })
          )
          .execute();

        return { id: mesa.id, name: mesa.name, qr_token: token };
      })
  );
}
