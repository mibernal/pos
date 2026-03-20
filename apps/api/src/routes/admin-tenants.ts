import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  tenantProfileSchema,
  updateTenantBusinessProfileBodySchema
} from '@pos-dian/shared';
import { AppError } from '../infra/errors/app-error.js';
import { writeAuditLog } from '../domain/audit/write-audit-log.js';

const updateTenantTaxProfileParamsSchema = tenantProfileSchema.pick({
  id: true
});

const updateTenantTaxProfileBodySchema = tenantProfileSchema.pick({
  taxMode: true
});

function mapTenantProfile(tenant: {
  id: string;
  name: string;
  nit: string;
  business_name: string;
  address: string;
  phone: string | null;
  footer_message: string | null;
  tax_mode: 'IVA' | 'INC_RESTAURANT';
  created_at: Date;
}) {
  return {
    id: tenant.id,
    name: tenant.name,
    nit: tenant.nit,
    businessName: tenant.business_name,
    address: tenant.address,
    phone: tenant.phone,
    footerMessage: tenant.footer_message,
    taxMode: tenant.tax_mode,
    createdAt: tenant.created_at.toISOString()
  };
}

export const adminTenantsRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/admin/tenants/current',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['admin-tenants'],
        security: [{ bearerAuth: [] }]
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const tenant = await app.db
        .selectFrom('tenants')
        .select([
          'id',
          'name',
          'nit',
          'business_name',
          'address',
          'phone',
          'footer_message',
          'tax_mode',
          'created_at'
        ])
        .where('id', '=', request.auth.tenantId)
        .executeTakeFirst();

      if (!tenant) {
        throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant no encontrado');
      }

      return tenantProfileSchema.parse(mapTenantProfile(tenant));
    }
  );

  typedApp.patch(
    '/admin/tenants/current',
    {
      preHandler: [app.requireRoles(['ADMIN'])],
      schema: {
        tags: ['admin-tenants'],
        security: [{ bearerAuth: [] }],
        body: updateTenantBusinessProfileBodySchema
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const payload = updateTenantBusinessProfileBodySchema.parse(request.body);

      const updatedTenant = await app.db.transaction().execute(async (trx) => {
        const currentTenant = await trx
          .selectFrom('tenants')
          .select([
            'id',
            'name',
            'nit',
            'business_name',
            'address',
            'phone',
            'footer_message',
            'tax_mode',
            'created_at'
          ])
          .where('id', '=', request.auth!.tenantId)
          .forUpdate()
          .executeTakeFirst();

        if (!currentTenant) {
          throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant no encontrado');
        }

        const nextTenant = await trx
          .updateTable('tenants')
          .set({
            ...(payload.name ? { name: payload.name } : {}),
            ...(payload.nit ? { nit: payload.nit } : {}),
            ...(payload.businessName ? { business_name: payload.businessName } : {}),
            ...(payload.address ? { address: payload.address } : {}),
            ...(Object.prototype.hasOwnProperty.call(payload, 'phone')
              ? { phone: payload.phone ?? null }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(payload, 'footerMessage')
              ? { footer_message: payload.footerMessage ?? null }
              : {})
          })
          .where('id', '=', request.auth!.tenantId)
          .returning([
            'id',
            'name',
            'nit',
            'business_name',
            'address',
            'phone',
            'footer_message',
            'tax_mode',
            'created_at'
          ])
          .executeTakeFirstOrThrow();

        await writeAuditLog(trx, {
          tenantId: request.auth!.tenantId,
          userId: request.auth!.userId,
          entityType: 'TENANT',
          entityId: nextTenant.id,
          action: 'TENANT_BUSINESS_PROFILE_UPDATED',
          payloadJson: {
            previous: {
              name: currentTenant.name,
              nit: currentTenant.nit,
              business_name: currentTenant.business_name,
              address: currentTenant.address,
              phone: currentTenant.phone,
              footer_message: currentTenant.footer_message
            },
            current: {
              name: nextTenant.name,
              nit: nextTenant.nit,
              business_name: nextTenant.business_name,
              address: nextTenant.address,
              phone: nextTenant.phone,
              footer_message: nextTenant.footer_message
            }
          }
        });

        return nextTenant;
      });

      if (!updatedTenant) {
        throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant no encontrado');
      }

      return tenantProfileSchema.parse(mapTenantProfile(updatedTenant));
    }
  );

  typedApp.patch(
    '/admin/tenants/:id/tax-profile',
    {
      preHandler: [app.requireRoles(['ADMIN'])],
      schema: {
        tags: ['admin-tenants'],
        security: [{ bearerAuth: [] }],
        params: updateTenantTaxProfileParamsSchema,
        body: updateTenantTaxProfileBodySchema
      }
    },
    async (request) => {
      if (!request.auth) {
        throw new AppError(401, 'AUTH_UNAUTHORIZED', 'No autorizado');
      }

      const params = updateTenantTaxProfileParamsSchema.parse(request.params);
      const payload = updateTenantTaxProfileBodySchema.parse(request.body);

      const updatedTenant = await app.db.transaction().execute(async (trx) => {
        const currentTenant = await trx
          .selectFrom('tenants')
          .select(['id', 'tax_mode'])
          .where('id', '=', request.auth!.tenantId)
          .where('id', '=', params.id)
          .forUpdate()
          .executeTakeFirst();

        if (!currentTenant) {
          throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant no encontrado');
        }

        const nextTenant = await trx
          .updateTable('tenants')
          .set({
            tax_mode: payload.taxMode
          })
          .where('id', '=', request.auth!.tenantId)
          .where('id', '=', params.id)
          .returning([
            'id',
            'name',
            'nit',
            'business_name',
            'address',
            'phone',
            'footer_message',
            'tax_mode',
            'created_at'
          ])
          .executeTakeFirstOrThrow();

        await writeAuditLog(trx, {
          tenantId: request.auth!.tenantId,
          userId: request.auth!.userId,
          entityType: 'TENANT',
          entityId: nextTenant.id,
          action: 'TENANT_TAX_MODE_UPDATED',
          payloadJson: {
            previous_tax_mode: currentTenant.tax_mode,
            new_tax_mode: nextTenant.tax_mode
          }
        });

        return nextTenant;
      });

      if (!updatedTenant) {
        throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant no encontrado');
      }

      return tenantProfileSchema.parse(mapTenantProfile(updatedTenant));
    }
  );
};
