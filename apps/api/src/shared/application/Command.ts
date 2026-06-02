export interface Command<T = unknown> {
  readonly _brand?: T;
}

export interface CommandHandler<TCommand extends Command, TResult = void> {
  handle(command: TCommand): Promise<TResult>;
}
