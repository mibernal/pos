import { describe, it, expect, vi } from 'vitest';
import { GetPlatformHealthUseCase } from './get-platform-health.use-case.js';
import { createRawSqlExecutorMock } from '../../../../../test/helpers/kysely-raw-sql-mock.js';

describe('GetPlatformHealthUseCase', () => {
  it('should return UP and correct metrics when all services are healthy', async () => {
    // Mock DB
    const dbMock: any = createRawSqlExecutorMock();

    // sql\`SELECT 1\`.execute(this.db) calls executeQuery internally or similar.
    // For Kysely we mock the `sql` template literal execution.
    // Actually, `sql` tag returns an object with `.execute(db)`. 
    // We can just mock db.executeQuery to not throw.
    
    // Mock Redis
    const redisMock: any = {
      ping: vi.fn().mockResolvedValue('PONG')
    };

    // Mock BullMQ Queue
    const queueMock: any = {
      getWorkers: vi.fn().mockResolvedValue([{ id: 'worker-1' }, { id: 'worker-2' }]),
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 5, active: 2 })
    };

    const useCase = new GetPlatformHealthUseCase(dbMock, redisMock, queueMock);
    const result = await useCase.execute();

    expect(result.status).toBe('UP');
    expect(result.services).toHaveLength(3);
    
    const dbService = result.services.find(s => s.name === 'PostgreSQL');
    expect(dbService?.status).toBe('UP');
    expect(typeof dbService?.latencyMs).toBe('number');

    const redisService = result.services.find(s => s.name === 'Redis');
    expect(redisService?.status).toBe('UP');
    expect(typeof redisService?.latencyMs).toBe('number');

    const mqService = result.services.find(s => s.name === 'BullMQ');
    expect(mqService?.status).toBe('UP');
    expect((mqService as any)?.activeWorkers).toBe(2);
    expect((mqService as any)?.pendingJobs).toBe(5);

    expect(result.api).toBeDefined();
    expect(result.environment).toBeDefined();
  });

  it('should return DEGRADED when Redis is down', async () => {
    const dbMock: any = createRawSqlExecutorMock();
    const redisMock: any = {
      ping: vi.fn().mockRejectedValue(new Error('Connection timeout'))
    };
    const queueMock: any = {
      getWorkers: vi.fn().mockResolvedValue([]),
      getJobCounts: vi.fn().mockResolvedValue({ waiting: 0 })
    };

    const useCase = new GetPlatformHealthUseCase(dbMock, redisMock, queueMock);
    const result = await useCase.execute();

    expect(result.status).toBe('DEGRADED');
    
    const redisService = result.services.find(s => s.name === 'Redis');
    expect(redisService?.status).toBe('DOWN');
    
    const dbService = result.services.find(s => s.name === 'PostgreSQL');
    expect(dbService?.status).toBe('UP');
  });
});
