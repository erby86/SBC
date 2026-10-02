/** Minimal Redis surface the worker needs; keeps the heartbeat testable without a server. */
export interface HeartbeatStore {
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

export const HEARTBEAT_KEY = 'worker:heartbeat';

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
