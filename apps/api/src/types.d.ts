import type { Kysely } from 'kysely';
import type { Redis } from 'ioredis';
import type { FastifyReply } from 'fastify';
import type { AuthContext, JwtClaims, UserRole, UserPermission } from './shared/infra/security/types.js';
import type { Database } from './shared/infra/db/schema.js';

declare module 'fastify' {
  interface FastifyInstance {
    // C7: dianQueue eliminado del API — el worker consume el outbox directamente.
    // C2: Redis para rate-limit y futuros usos.
    redis: Redis;
    db: Kysely<Database>;
    authenticate: (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;

    requirePermissions: (
      permissions: UserPermission[]
    ) => (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;

    requirePlatformOwner: (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;

    requireTenantOwnerOrAdmin: (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtClaims;
    user: JwtClaims;
  }
}
