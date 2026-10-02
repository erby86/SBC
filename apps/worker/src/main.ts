import { createDbPool } from '@sbc-noc/db';
import { parseEnv, serverEnvSchema } from '@sbc-noc/shared';
import { Redis } from 'ioredis';
import { beat } from './heartbeat.js';
import { createZabbixClient } from './connectors/zabbix.js';
import { registryStats } from './jobs/registry-stats.js';
import type { JobDefinition } from './jobs/types.js';
import { zabbixMatchJob } from './jobs/zabbix-match.js';
import { startRuntime } from './runtime/queue.js';
import { start } from './start.js';

const HEARTBEAT_MS = 30_000;
const HEARTBEAT_TTL_SECONDS = 90;

const env = parseEnv(serverEnvSchema, process.env);
const logger = { info: (m: string) => console.info(m), warn: (m: string) => console.warn(m) };

const db = createDbPool(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { keyPrefix: env.REDIS_PREFIX, maxRetriesPerRequest: 1 });
redis.on('error', (err: Error) => logger.warn(`redis error: ${err.message}`));

start();

const jobs: JobDefinition[] = [registryStats];
const zabbixUrl = process.env['ZABBIX_URL'];
const zabbixToken = process.env['ZABBIX_TOKEN_READ'];
if (zabbixUrl && zabbixToken) {
  jobs.push(zabbixMatchJob(createZabbixClient(zabbixUrl, zabbixToken)));
} else {
  logger.warn('ZABBIX_URL / ZABBIX_TOKEN_READ not set — zabbix-match disabled');
}
const runtime = await startRuntime({
  redisUrl: env.REDIS_URL,
  redisPrefix: env.REDIS_PREFIX,
  db,
  jobs,
  logger,
});

async function tick(): Promise<void> {
  try {
    await beat(redis, HEARTBEAT_TTL_SECONDS);
  } catch (err) {
    logger.warn(`heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

await tick();
const timer = setInterval(() => void tick(), HEARTBEAT_MS);

async function shutdown(signal: string): Promise<void> {
  logger.info(`sbc-noc worker stopping (${signal})`);
  clearInterval(timer);
  await runtime.close().catch(() => undefined);
  await Promise.allSettled([redis.quit(), db.end()]);
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
