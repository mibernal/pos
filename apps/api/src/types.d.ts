import type { Queue } from 'bullmq';
import type { Kysely } from 'kysely';
import type { FastifyReply } from 'fastify';
import type { DianEmissionRequest } from '@pos-dian/shared';
import type { AuthContext, JwtClaims, UserRole } from './auth/types.js';
import type { Database } from './infra/db/schema.js';

declare module 'fastify' {
  interface FastifyInstance {
    dianQueue: Queue<DianEmissionRequest>;
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
