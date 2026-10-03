import {
  createDbPool,
  getBuilding,
  getDevice,
  getLayout,
  getLocation,
  listBuildings,
  listCables,
  listDevices,
  listLinks,
  listLocations,
  pingDatabase,
  runRegistryChecks,
  search,
} from '@sbc-noc/db';
import { parseEnv, serverEnvSchema, statusSnapshotSchema } from '@sbc-noc/shared';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { buildApp } from './app.js';
import { createLiveHub } from './routes/live.js';

const env = parseEnv(
  serverEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(3001),
    HOST: z.string().default('0.0.0.0'),
    DEMO_MODE: z.stringbool().default(false),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  }),
  process.env,
);

const pool = createDbPool(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, {
  keyPrefix: env.REDIS_PREFIX,
  maxRetriesPerRequest: 1,
  lazyConnect: true,
});

const readSnapshot = async () => {
  const raw = await redis.get('status:snapshot'); // written by the worker (M15)
  return raw ? statusSnapshotSchema.parse(JSON.parse(raw)) : null;
};

// M16: one subscriber connection for the whole api; channels are not prefixed by ioredis.
const updatesChannel = `${env.REDIS_PREFIX}status:updates`;
const live = createLiveHub(
  {
    read: readSnapshot,
    subscribe: async (onMessage) => {
      const sub = new Redis(env.REDIS_URL, { lazyConnect: true });
      sub.on('error', (err) => console.warn(`redis subscriber: ${err.message}`));
      sub.on('message', (channel: string, message: string) => {
        if (channel === updatesChannel) onMessage(message);
      });
      await sub.connect();
      await sub.subscribe(updatesChannel);
      return async () => {
        await sub.quit().catch(() => undefined);
      };
    },
  },
  { warn: (o, m) => console.warn(m, o) },
);

// pino JSON logs to stdout (collected by docker / Loki later); never log credentials.
const app = await buildApp(
  {
    logger: {
      level: env.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
  },
  {
    checks: {
      db: () => pingDatabase(pool),
      redis: () => redis.ping(),
    },
    demo: env.DEMO_MODE,
    status: readSnapshot,
    live,
    registryChecks: () => runRegistryChecks(pool),
    registry: {
      layout: () => getLayout(pool),
      buildings: () => listBuildings(pool),
      building: (code) => getBuilding(pool, code),
      locations: (f) => listLocations(pool, f),
      location: (code) => getLocation(pool, code),
      devices: (f) => listDevices(pool, f),
      device: (code) => getDevice(pool, code),
      links: () => listLinks(pool),
      cables: () => listCables(pool),
      search: (q, limit) => search(pool, q, limit),
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

if (env.DEMO_MODE) app.log.warn('DEMO_MODE on: /demo/* serves demo scenarios (ADR-0014)');

try {
  await redis.connect().catch((err: unknown) => app.log.warn({ err }, 'redis not reachable yet'));
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
