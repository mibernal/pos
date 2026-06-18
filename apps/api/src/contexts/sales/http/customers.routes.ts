import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import {
  createCustomerBodySchema,
  updateCustomerBodySchema,
  customerIdParamsSchema
} from '@pos-dian/shared';

const customerColumnList = [
  'id',
  'tenant_id',
  'document_type',
  'document_number',
  'name',
  'email',
  'phone',
  'address',
  'created_at',
  'updated_at'
] as const;

export const customersRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post(
    '/customers',
    {
      preHandler: [app.requirePermissions(['customers:create'])],
      schema: {
        tags: ['customers'],
        security: [{ bearerAuth: [] }],
        body: createCustomerBodySchema
      }
    },
    async (request, reply) => {
      const payload = request.body;

      return await request.executeAsTenant(async (trx) => {
      const existing = await trx
        .selectFrom('customers')
        .select('id')
        .where('tenant_id', '=', request.auth!.tenantId!)
        .where('document_type', '=', payload.document_type)
        .where('document_number', '=', payload.document_number)
        .executeTakeFirst();

      if (existing) {
        throw new AppError(409, 'CUSTOMER_EXISTS', 'Ya existe un cliente con este documento');
      }

      const newCustomer = await trx
        .insertInto('customers')
        .values({
          id: randomUUID(),
          tenant_id: request.auth!.tenantId!,
          document_type: payload.document_type,
          document_number: payload.document_number,
          name: payload.name,
          email: payload.email ?? null,
          phone: payload.phone ?? null,
          address: payload.address ?? null
        })
        .returning([...customerColumnList])
        .executeTakeFirstOrThrow();

      return reply.code(201).send({
        ...newCustomer,
        created_at: newCustomer.created_at.toISOString(),
        updated_at: newCustomer.updated_at.toISOString()
      });
      });
    }
  );

  typedApp.get(
    '/customers',
    {
      preHandler: [app.requirePermissions(['customers:view'])],
      schema: {
        tags: ['customers'],
        security: [{ bearerAuth: [] }]
      }
    },
    async (request) => {
      return await request.executeAsTenant(async (trx) => {
      const rows = await trx
        .selectFrom('customers')
        .select([...customerColumnList])
        .where('tenant_id', '=', request.auth!.tenantId!)
        .orderBy('created_at', 'desc')
        .execute();

      return rows.map((row) => ({
        ...row,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString()
      }));
      });
    }
  );

  typedApp.patch(
    '/customers/:id',
    {
      preHandler: [app.requirePermissions(['customers:update'])],
      schema: {
        tags: ['customers'],
        security: [{ bearerAuth: [] }],
        params: customerIdParamsSchema,
        body: updateCustomerBodySchema
      }
    },
    async (request) => {
      const { id } = request.params;
      const payload = request.body;

      return await request.executeAsTenant(async (trx) => {
      const existing = await trx
        .selectFrom('customers')
        .select(['id', 'document_type', 'document_number'])
        .where('tenant_id', '=', request.auth!.tenantId!)
        .where('id', '=', id)
        .executeTakeFirst();

      if (!existing) {
        throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Cliente no encontrado');
      }

      const nextDocumentType = payload.document_type ?? existing.document_type;
      const nextDocumentNumber = payload.document_number ?? existing.document_number;

      if (
        nextDocumentType !== existing.document_type ||
        nextDocumentNumber !== existing.document_number
      ) {
        const duplicatedCustomer = await trx
          .selectFrom('customers')
          .select('id')
          .where('tenant_id', '=', request.auth!.tenantId!)
          .where('document_type', '=', nextDocumentType)
          .where('document_number', '=', nextDocumentNumber)
          .where('id', '!=', id)
          .executeTakeFirst();

        if (duplicatedCustomer) {
          throw new AppError(409, 'CUSTOMER_EXISTS', 'Ya existe un cliente con este documento');
        }
      }

      const toUpdate: Record<string, unknown> = {};
      
      if (payload.name !== undefined) toUpdate.name = payload.name;
      if (payload.document_type !== undefined) toUpdate.document_type = payload.document_type;
      if (payload.document_number !== undefined) toUpdate.document_number = payload.document_number;
      if (payload.email !== undefined) toUpdate.email = payload.email ?? null;
      if (payload.phone !== undefined) toUpdate.phone = payload.phone ?? null;
      if (payload.address !== undefined) toUpdate.address = payload.address ?? null;

      const updated = await trx
        .updateTable('customers')
        .set(toUpdate)
        .where('tenant_id', '=', request.auth!.tenantId!)
        .where('id', '=', id)
        .returning([...customerColumnList])
        .executeTakeFirstOrThrow();

      return {
        ...updated,
        created_at: updated.created_at.toISOString(),
        updated_at: updated.updated_at.toISOString()
      };
      });
    }
  );
};
