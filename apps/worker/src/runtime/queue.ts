import type { DbPool } from '@sbc-noc/db';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { JobDefinition } from '../jobs/types.js';
import { recordRun } from './runs.js';

export const QUEUE_NAME = 'sync';

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export interface JobRuntime {
  queue: Queue;
  close(): Promise<void>;
}

export interface RuntimeOptions {
  redisUrl: string;
  /** Key prefix on the shared sbc-redis, e.g. "noc:" or "noc:dev:" (BullMQ keys go under <prefix>bull). */
  redisPrefix: string;
  db: DbPool;
  jobs: JobDefinition[];
  logger: Logger;
  /** Exponential backoff base for retries (ms). */
  backoffMs?: number;
  /** Register the repeat schedules (false in tests that add jobs by hand). */
  schedule?: boolean;
}

/** Starts the BullMQ queue + worker and (optionally) upserts one job scheduler per job. */
export async function startRuntime(opts: RuntimeOptions): Promise<JobRuntime> {
  const byName = new Map(opts.jobs.map((j) => [j.name, j]));
  // BullMQ manages its own key prefix; the connection must not use ioredis keyPrefix.
  const connection = new Redis(opts.redisUrl, { maxRetriesPerRequest: null });
  const prefix = `${opts.redisPrefix}bull`;

  const queue = new Queue(QUEUE_NAME, { connection, prefix });
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const def = byName.get(job.name);
      if (!def) throw new Error(`unknown job ${job.name}`);
      return recordRun(opts.db, def, job.attemptsMade + 1);
    },
    { connection: connection.duplicate(), prefix, concurrency: 1 },
  );
  worker.on('failed', (job, err) =>
    opts.logger.warn(`job ${job?.name} attempt ${job?.attemptsMade} failed: ${err.message}`),
  );
  worker.on('completed', (job) => opts.logger.info(`job ${job.name} done`));

  if (opts.schedule !== false) {
    for (const def of opts.jobs) {
      const repeat =
        'every' in def.schedule
          ? { every: def.schedule.every }
          : { pattern: def.schedule.pattern, tz: 'Asia/Bangkok' };
      await queue.upsertJobScheduler(def.name, repeat, {
        name: def.name,
        opts: {
          attempts: def.attempts,
          backoff: { type: 'exponential', delay: opts.backoffMs ?? 30_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      });
      opts.logger.info(`scheduled ${def.name} ${JSON.stringify(repeat)}`);
    }
  }

  return {
    queue,
    async close() {
      await worker.close();
      await queue.close();
      await connection.quit();
    },
  };
}
