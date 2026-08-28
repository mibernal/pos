import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { AppError } from '../infra/errors/app-error.js';
import { buildRequestLogContext } from '../infra/logging/request-log-context.js';

function logHandledError(
  request: FastifyRequest,
  level: 'warn' | 'error',
  error: unknown,
  code: string,
  details: unknown,
  message: string
) {
  const payload = {
    ...buildRequestLogContext(request),
    error_code: code,
    error_details: details,
    err: error
  };

  if (level === 'error') {
    request.log.error(payload, message);
    return;
  }

  request.log.warn(payload, message);
}

const errorHandlerPluginImpl: FastifyPluginAsync = async (app) => {
  app.setNotFoundHandler((request, reply) => {
    request.log.warn(
      {
        ...buildRequestLogContext(request),
        error_code: 'NOT_FOUND'
      },
      'Route not found'
    );

    return reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint no encontrado',
        details: null
      }
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      logHandledError(
        request,
        error.statusCode >= 500 ? 'error' : 'warn',
        error,
        (error as any).code, // eslint-disable-line @typescript-eslint/no-explicit-any
        error.details ?? null,
        'Request failed with application error'
      );

      return reply.status(error.statusCode).send({
        error: {
          code: (error as any).code, // eslint-disable-line @typescript-eslint/no-explicit-any
          message: error.statusCode >= 500 ? 'Ocurrió un error interno' : (error as any).message, // eslint-disable-line @typescript-eslint/no-explicit-any
          details: error.statusCode >= 500 ? null : error.details ?? null
        }
      });
    }

    if (error instanceof ZodError) {
      logHandledError(
        request,
        'warn',
        error,
        'VALIDATION_ERROR',
        error.flatten(),
        'Request validation failed'
      );

      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Solicitud inválida',
          details: error.flatten()
        }
      });
    }

    // Validación de la petición hecha por Fastify a partir del esquema Zod de la ruta.
    //
    // El error que llega aquí NO es un `ZodError`: `fastify-type-provider-zod` lo envuelve
    // en un error propio de Fastify. Sin esta rama caía hasta el 500 genérico, de modo que
    // *toda* petición mal formada del cliente respondía "Ocurrió un error interno" con
    // `details: null` — el servidor culpándose a sí mismo del error del cliente, y sin
    // decir qué campo estaba mal. Fue así como se manifestó el intento de crear un usuario
    // con rol WAITER cuando el enum de la ruta todavía no lo incluía.
    if (hasZodFastifySchemaValidationErrors(error)) {
      // `instancePath` viene como "/role" o "/items/0/qty"; se normaliza a la notación por
      // puntos que ya usa el resto de los errores de validación de la API.
      const details = {
        issues: error.validation.map((issue) => ({
          path: issue.instancePath.replace(/^\//, '').replaceAll('/', '.'),
          message: issue.message ?? 'Valor inválido',
          code: issue.keyword
        }))
      };

      logHandledError(request, 'warn', error, 'VALIDATION_ERROR', details, 'Request validation failed');

      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Solicitud inválida',
          details
        }
      });
    }

    // La respuesta no cumple el esquema declarado por la ruta. Es un defecto del servidor,
    // no del cliente, y se registra como tal: 500, pero con el detalle en el log para que
    // no haya que adivinar qué campo faltaba.
    if (isResponseSerializationError(error)) {
      logHandledError(
        request,
        'error',
        error,
        'RESPONSE_SERIALIZATION_ERROR',
        { method: error.method, url: error.url, issues: error.cause.issues },
        'Response did not match the declared schema'
      );

      return reply.status(500).send({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Ocurrió un error interno',
          details: null
        }
      });
    }

    const errorLike = error as { code?: string };

    if (typeof errorLike.code === 'string' && errorLike.code.startsWith('FST_JWT')) {
      logHandledError(
        request,
        'warn',
        error,
        'AUTH_UNAUTHORIZED',
        null,
        'Request rejected due to invalid authentication token'
      );

      return reply.status(401).send({
        error: {
          code: 'AUTH_UNAUTHORIZED',
          message: 'No autorizado: token inválido o ausente',
          details: null
        }
      });
    }

    if (errorLike.code === '23505') {
      logHandledError(
        request,
        'warn',
        error,
        'DB_UNIQUE_VIOLATION',
        null,
        'Request failed due to unique constraint violation'
      );

      return reply.status(409).send({
        error: {
          code: 'DB_UNIQUE_VIOLATION',
          message: 'El recurso ya existe',
          details: null
        }
      });
    }

    request.log.error(
      {
        ...buildRequestLogContext(request),
        error_code: 'INTERNAL_SERVER_ERROR',
        err: error
      },
      'Request failed unexpectedly'
    );

    return reply.status(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Ocurrió un error interno',
        details: null
      }
    });
  });
};

/**
 * Debe registrarse con `fastify-plugin`.
 *
 * Fastify encapsula los plugins: sin `fp`, `setErrorHandler` y `setNotFoundHandler`
 * quedaban confinados al ámbito (vacío) de este plugin y NINGUNA ruta hermana los
 * usaba. En la práctica la API respondía con el formato por defecto de Fastify en vez
 * del contrato `{ error: { code, message, details } }`, el registro estructurado de
 * errores no se ejecutaba nunca, y los 500 devolvían el mensaje interno en lugar del
 * texto saneado.
 */
export const errorHandlerPlugin = fp(errorHandlerPluginImpl, {
  name: 'error-handler-plugin'
});
