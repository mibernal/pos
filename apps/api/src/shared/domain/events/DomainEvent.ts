export interface DomainEvent<TPayload = any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  id: string;
  type: string;
  version: number;
  aggregateId: string;
  aggregateType: string;
  branchId?: string;
  occurredAt: Date;
  payload: TPayload;
}

export abstract class BaseDomainEvent<TPayload = any> implements DomainEvent<TPayload> { // eslint-disable-line @typescript-eslint/no-explicit-any
  public readonly id: string;
  public readonly occurredAt: Date;

  constructor(
    public readonly type: string,
    public readonly version: number,
    public readonly aggregateId: string,
    public readonly aggregateType: string,
    public readonly payload: TPayload,
    public readonly branchId?: string,
    id?: string,
    occurredAt?: Date
  ) {
    this.id = id || crypto.randomUUID();
    this.occurredAt = occurredAt || new Date();
  }
}
