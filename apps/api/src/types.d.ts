import type { Kysely } from 'kysely';
import type { Redis } from 'ioredis';
import type { FastifyReply } from 'fastify';
import type { AuthContext, JwtClaims, UserRole, UserPermission } from './shared/infra/security/types.js'; // eslint-disable-line @typescript-eslint/no-unused-vars
import type { Database } from './shared/infra/db/schema.js';
import type { BusinessModule } from '@pos-dian/shared';

declare module 'fastify' {
  interface FastifyInstance {
    // C7: dianQueue eliminado del API — el worker consume el outbox directamente.
    // C2: Redis para rate-limit y futuros usos.
    redis: Redis;
    pubsub: import('./shared/infra/pubsub/pubsub.service.js').PubSubService;
    db: Kysely<Database>;
    authenticate: (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;

    requirePermissions: (
      permissions: UserPermission[]
    ) => (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;

    requirePlatformOwner: (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;

    requireTenantOwnerOrAdmin: (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;

    requireModule: (
      modules: BusinessModule[]
    ) => (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    auth: AuthContext | null;
    executeAsTenant: <T>(callback: (trx: import('kysely').Transaction<Database>) => Promise<T>) => Promise<T>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtClaims;
    user: JwtClaims;
  }
}
