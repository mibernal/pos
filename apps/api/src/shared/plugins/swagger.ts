import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import type { FastifyInstance } from 'fastify';

async function registerSwaggerImpl(app: FastifyInstance): Promise<void> {
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

/**
 * Va envuelto en `fastify-plugin` — y sin eso no documentaba nada.
 *
 * Un plugin de Fastify sin envolver crea su propio contexto: `@fastify/swagger` recolecta
 * las rutas del contexto donde vive, y todas las de esta aplicación se registran después y
 * fuera de él. El resultado era un contrato con `info`, `components` y **cero rutas**: la
 * página de `/docs` existía y no documentaba ni un endpoint, mientras el proyecto se
 * apuntaba tener «OpenAPI publicado».
 *
 * Lo encontró el volcado del contrato para generar el cliente del frontend: no se puede
 * generar nada a partir de un contrato vacío.
 */
export const registerSwagger = fp(registerSwaggerImpl, {
  name: 'swagger',
  fastify: '5.x'
});
