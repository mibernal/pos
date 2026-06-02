import type { Command } from '../../../shared/application/Command.js';
import type { CreateSaleBodyInput } from '../services/schemas.js';
import type { FastifyBaseLogger } from 'fastify';

export class CreateSaleCommand implements Command {
  public readonly _brand?: unknown;

  constructor(
    public readonly payload: CreateSaleBodyInput,
    public readonly tenantId: string,
    public readonly userId: string,
    public readonly userRole: string,
    public readonly logger: FastifyBaseLogger,
    public readonly requestLogContext: Record<string, unknown>
  ) {}
}
