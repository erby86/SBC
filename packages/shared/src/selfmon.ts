// M35 self-monitoring (ADR-0010): keys the worker writes to Redis and the api reads for /metrics.
// Zabbix scrapes /api/metrics; the router's Netwatch watches the server and /api/health separately.
import { z } from 'zod';

/** ISO time of the last worker heartbeat; expires 90 s after the last beat. */
export const WORKER_HEARTBEAT_KEY = 'worker:heartbeat';

/** Queue counters, refreshed with every heartbeat and expiring with it. */
export const WORKER_QUEUE_KEY = 'worker:queue';

export const workerQueueSchema = z.object({
  at: z.iso.datetime(),
  /** BullMQ job counts by state (wait, active, delayed, failed, ...). */
  counts: z.record(z.string(), z.number().int().nonnegative()),
  /** Enqueue time of the oldest job still waiting; null when none waits. */
  oldestWaitingAt: z.iso.datetime().nullable(),
});
export type WorkerQueueState = z.infer<typeof workerQueueSchema>;

/** sync.runs status of a run cut short by a worker restart; not counted as a failure. */
export const RUN_INTERRUPTED = 'interrupted';
