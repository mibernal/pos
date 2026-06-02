import type { CommandHandler } from '../../../shared/application/Command.js';
import type { CreateSaleCommand } from './CreateSaleCommand.js';
import { createSaleService } from '../services/create-sale.service.js';
import type { Kysely } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';

export class CreateSaleHandler implements CommandHandler<CreateSaleCommand, any> {
  constructor(private readonly db: Kysely<Database>) {}

  async handle(command: CreateSaleCommand): Promise<any> {
    // Delega a la función original que refactorizamos para usar este pipeline CQRS
    return createSaleService({
      db: this.db,
      logger: command.logger,
      tenantId: command.tenantId,
      userId: command.userId,
      userRole: command.userRole,
      payload: command.payload,
      requestLogContext: command.requestLogContext,
    });
  }
}
