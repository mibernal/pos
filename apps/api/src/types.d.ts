import type { Kysely } from 'kysely';
import type { Redis } from 'ioredis';
import type { FastifyReply } from 'fastify';
import type { AuthContext, JwtClaims, UserRole } from './auth/types.js';
import type { Database } from './infra/db/schema.js';

declare module 'fastify' {
  interface FastifyInstance {
    // C7: dianQueue eliminado del API — el worker consume el outbox directamente.
    // C2: Redis para rate-limit y futuros usos.
    redis: Redis;
    db: Kysely<Database>;
    authenticate: (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;
    requireRoles: (
      roles: UserRole[]
    ) => (request: FastifyRequest, reply?: FastifyReply) => Promise<void>;
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
