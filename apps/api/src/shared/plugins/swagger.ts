import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import type { FastifyInstance } from 'fastify';

export async function registerSwagger(app: FastifyInstance): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    app.log.info('Swagger is disabled in production.');
    return;
  }

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'POS DIAN API',
        version: '0.1.0',
        description: 'API multi-tenant para POS con emisión DIAN desacoplada'
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        }
      },
      tags: [
        { name: 'system', description: 'Endpoints de salud del sistema' },
        { name: 'auth', description: 'Autenticación y sesión' },
        { name: 'branches', description: 'Sucursales del tenant y caja actual' },
        { name: 'sales', description: 'Operación POS de ventas' },
        { name: 'cash-sessions', description: 'Apertura y cierre de caja por sucursal' },
        { name: 'products', description: 'Catálogo de productos por tenant/sucursal' },
        { name: 'admin-tenants', description: 'Administración de tenant' },
        { name: 'admin-users', description: 'Administración de usuarios' }
      ]
    },
    transform: jsonSchemaTransform
  });

  await app.register(swaggerUI, {
    routePrefix: '/docs'
  });
}
