import type { Queue } from 'bullmq';
import { WORKER_HEARTBEAT_KEY, WORKER_QUEUE_KEY, type WorkerQueueState } from '@sbc-noc/shared';

/** Minimal Redis surface the worker needs; keeps the heartbeat testable without a server. */
export interface HeartbeatStore {
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

/** The part of a BullMQ Queue the heartbeat reads. */
export type QueueProbe = Pick<Queue, 'getJobCounts' | 'getJobs'>;

export const HEARTBEAT_KEY = WORKER_HEARTBEAT_KEY;

/**
 * Writes `<REDIS_PREFIX>worker:heartbeat` with a TTL so monitoring (ADR-0010)
 * can tell the worker is alive. The prefix is applied by the Redis client.
 */
export async function beat(
  store: HeartbeatStore,
  ttlSeconds: number,
  now = new Date(),
): Promise<void> {
  await store.set(HEARTBEAT_KEY, now.toISOString(), 'EX', ttlSeconds);
}

/** Writes the queue counters for /metrics (M35), expiring with the heartbeat. */
export async function writeQueueState(
  store: HeartbeatStore,
  queue: QueueProbe,
  ttlSeconds: number,
  now = new Date(),
): Promise<WorkerQueueState> {
  const counts = await queue.getJobCounts('wait', 'active', 'delayed', 'failed', 'prioritized');
  const [oldest] = await queue.getJobs(['wait', 'prioritized'], 0, 0, true);
  const state: WorkerQueueState = {
    at: now.toISOString(),
    counts,
    oldestWaitingAt: oldest ? new Date(oldest.timestamp).toISOString() : null,
  };
  await store.set(WORKER_QUEUE_KEY, JSON.stringify(state), 'EX', ttlSeconds);
  return state;
}
