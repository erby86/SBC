import { createDbPool, pingDatabase } from '@sbc-noc/db';
import { parseEnv, serverEnvSchema } from '@sbc-noc/shared';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { buildApp } from './app.js';

const env = parseEnv(
  serverEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(3001),
    HOST: z.string().default('0.0.0.0'),
  }),
  process.env,
);

const pool = createDbPool(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, {
  keyPrefix: env.REDIS_PREFIX,
  maxRetriesPerRequest: 1,
  lazyConnect: true,
});

const app = buildApp(
  { logger: true },
  {
    checks: {
      db: () => pingDatabase(pool),
      redis: () => redis.ping(),
    },
  },
);

redis.on('error', (err) => app.log.warn({ err }, 'redis error'));

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await Promise.allSettled([pool.end(), redis.quit()]);
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  await redis.connect().catch((err: unknown) => app.log.warn({ err }, 'redis not reachable yet'));
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
