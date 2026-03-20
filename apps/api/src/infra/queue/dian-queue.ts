import { Queue } from 'bullmq';
import { DIAN_QUEUE_NAME, type DianEmissionRequest } from '@pos-dian/shared';

export function buildDianQueue(redisUrl: string): Queue<DianEmissionRequest> {
  return new Queue<DianEmissionRequest>(DIAN_QUEUE_NAME, {
    connection: {
      url: redisUrl
    },
    defaultJobOptions: {
      attempts: 6,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: 100,
      removeOnFail: 500
    }
  });
}
