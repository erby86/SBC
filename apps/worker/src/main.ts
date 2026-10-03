import { createDbPool } from '@sbc-noc/db';
import { parseEnv, serverEnvSchema } from '@sbc-noc/shared';
import { readFileSync } from 'node:fs';
import { Redis } from 'ioredis';
import { beat } from './heartbeat.js';
import { createUnifiClient } from './connectors/unifi.js';
import { createZabbixClient } from './connectors/zabbix.js';
import { registryStats } from './jobs/registry-stats.js';
import type { JobDefinition } from './jobs/types.js';
import { unifiApsJob } from './jobs/unifi-aps.js';
import { zabbixMatchJob } from './jobs/zabbix-match.js';
import { zabbixTagsJob } from './jobs/zabbix-tags.js';
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
// ADR-0019: separate write token; which hosts it can change is limited by Zabbix permissions.
const zabbixSyncToken = process.env['ZABBIX_TOKEN_SYNC'];
const tagGroups = (process.env['ZABBIX_TAG_GROUPS'] ?? '')
  .split(',')
  .map((g) => g.trim())
  .filter(Boolean);
if (zabbixUrl && zabbixSyncToken) {
  jobs.push(zabbixTagsJob(createZabbixClient(zabbixUrl, zabbixSyncToken), tagGroups));
} else {
  logger.warn('ZABBIX_TOKEN_SYNC not set — zabbix-tags disabled');
}
// M06: UniFi controller, read-only View Only user. TLS: pinned certificate file (or insecure for a test).
const unifiUrl = process.env['UNIFI_URL'];
const unifiUser = process.env['UNIFI_USERNAME'];
const unifiPassword = process.env['UNIFI_PASSWORD'];
const unifiCaFile = process.env['UNIFI_CA_FILE'];
const unifiInsecure = process.env['UNIFI_TLS_INSECURE'] === 'true';
if (unifiUrl && unifiUser && unifiPassword && (unifiCaFile || unifiInsecure)) {
  if (!unifiCaFile) logger.warn('UNIFI_TLS_INSECURE=true — controller certificate not checked');
  const host = new URL(unifiUrl).hostname;
  jobs.push(
    unifiApsJob(
      createUnifiClient({
        url: unifiUrl,
        username: unifiUser,
        password: unifiPassword,
        site: process.env['UNIFI_SITE'] || 'default',
        ...(unifiCaFile ? { ca: readFileSync(unifiCaFile, 'utf8') } : { insecure: true }),
      }),
      {
        name: `UniFi OS Server (${host})`,
        ip: /^[\d.]+$/.test(host) ? host : null,
        code: process.env['UNIFI_CONTROLLER_CODE'] ?? '',
      },
    ),
  );
} else {
  logger.warn(
    'UNIFI_URL / UNIFI_USERNAME / UNIFI_PASSWORD / UNIFI_CA_FILE not set — unifi-aps disabled',
  );
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
