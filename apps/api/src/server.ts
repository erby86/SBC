import {
  createDevice,
  createLocation,
  deleteDevice,
  getDeviceEdit,
  getEditOptions,
  getHistory,
  getLocationEdit,
  listUnplacedAps,
  placeUnplacedAp,
  updateDevice,
  updateLocation,
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
  readSyncHealth,
  runRegistryChecks,
  search,
} from '@sbc-noc/db';
import {
  optionalLinkTemplateSchema,
  parseEnv,
  serverEnvSchema,
  statusHistorySchema,
  statusSnapshotSchema,
  unlocatedListSchema,
  WORKER_HEARTBEAT_KEY,
  WORKER_QUEUE_KEY,
  workerQueueSchema,
} from '@sbc-noc/shared';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { buildApp } from './app.js';
import { createLiveHub } from './routes/live.js';

const env = parseEnv(
  serverEnvSchema.extend({
    PORT: z.coerce.number().int().positive().default(3001),
    HOST: z.string().default('0.0.0.0'),
    DEMO_MODE: z.stringbool().default(false),
    REGISTRY_EDIT: z.stringbool().default(false),
    // M22 out-links (templates, see packages/shared/src/links.ts); empty = no button
    LINK_ZABBIX_URL: optionalLinkTemplateSchema,
    LINK_GRAFANA_URL: optionalLinkTemplateSchema,
    LINK_GLPI_URL: optionalLinkTemplateSchema,
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

// M20: history and unlocated hosts, refreshed by the worker every few minutes
const readJson =
  <T>(key: string, parse: (v: unknown) => T) =>
  async (): Promise<T | null> => {
    const raw = await redis.get(key);
    return raw ? parse(JSON.parse(raw)) : null;
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
    links: {
      zabbix: env.LINK_ZABBIX_URL ?? null,
      grafana: env.LINK_GRAFANA_URL ?? null,
      glpi: env.LINK_GLPI_URL ?? null,
    },
    status: readSnapshot,
    // M35: read on every /metrics scrape (Zabbix, once a minute)
    selfmon: {
      heartbeat: () => redis.get(WORKER_HEARTBEAT_KEY),
      queue: readJson(WORKER_QUEUE_KEY, (v) => workerQueueSchema.parse(v)),
      snapshotAt: async () => (await readSnapshot())?.generatedAt ?? null,
      syncJobs: () => readSyncHealth(pool),
    },
    statusExtras: {
      history: readJson('status:history', (v) => statusHistorySchema.parse(v)),
      unlocated: readJson('status:unlocated', (v) => unlocatedListSchema.parse(v)),
    },
    ...(env.REGISTRY_EDIT
      ? {
          registryEdit: {
            options: () => getEditOptions(pool),
            device: (code) => getDeviceEdit(pool, code),
            updateDevice: (code, patch, actor) => updateDevice(pool, code, patch, actor),
            createDevice: (input, actor) => createDevice(pool, input, actor),
            deleteDevice: (code, rv, actor) => deleteDevice(pool, code, rv, actor),
            location: (loc) => getLocationEdit(pool, loc),
            updateLocation: (loc, patch, actor) => updateLocation(pool, loc, patch, actor),
            createLocation: (input, actor) => createLocation(pool, input, actor),
            unplaced: () => listUnplacedAps(pool),
            placeAp: (system, mac, where, actor) =>
              placeUnplacedAp(pool, system, mac, where, actor),
            history: (kind, code) => getHistory(pool, kind, code),
          },
        }
      : {}),
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

if (env.REGISTRY_EDIT)
  app.log.warn('REGISTRY_EDIT on: registry editor without login (ADR-0020, dev only)');
if (env.DEMO_MODE) app.log.warn('DEMO_MODE on: /demo/* serves demo scenarios (ADR-0014)');

try {
  await redis.connect().catch((err: unknown) => app.log.warn({ err }, 'redis not reachable yet'));
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
