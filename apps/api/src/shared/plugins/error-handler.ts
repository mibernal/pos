import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
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

export const errorHandlerPlugin: FastifyPluginAsync = async (app) => {
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
