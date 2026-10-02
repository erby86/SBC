import { parseEnv, serverEnvSchema } from '@sbc-noc/shared';
import { Redis } from 'ioredis';
import { beat } from './heartbeat.js';
import { start } from './start.js';

const INTERVAL_MS = 30_000;
const TTL_SECONDS = 90;

const env = parseEnv(serverEnvSchema, process.env);
const redis = new Redis(env.REDIS_URL, { keyPrefix: env.REDIS_PREFIX, maxRetriesPerRequest: 1 });
redis.on('error', (err: Error) => console.warn(`redis error: ${err.message}`));

start();

async function tick(): Promise<void> {
  try {
    await beat(redis, TTL_SECONDS);
  } catch (err) {
    console.warn(`heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

await tick();
const timer = setInterval(() => void tick(), INTERVAL_MS);

function shutdown(signal: string): void {
  console.info(`sbc-noc worker stopping (${signal})`);
  clearInterval(timer);
  void redis.quit().finally(() => process.exit(0));
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
