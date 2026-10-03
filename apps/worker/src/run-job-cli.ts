// Queue one run of a scheduled job now, e.g. after a deploy:
//   docker exec sbc-noc-dev-worker node dist/run-job-cli.js unifi-aps
// The running worker picks it up and records it in sync.runs like a scheduled run.
import { parseEnv, serverEnvSchema } from '@sbc-noc/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAME } from './runtime/queue.js';

const name = process.argv[2];
if (!name) {
  console.error(
    'usage: node dist/run-job-cli.js <job name>  (registry-stats, zabbix-match, zabbix-tags, unifi-aps)',
  );
  process.exit(2);
}
const env = parseEnv(serverEnvSchema, process.env);
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue(QUEUE_NAME, { connection, prefix: `${env.REDIS_PREFIX}bull` });
const scheduled = (await queue.getJobSchedulers()).map((s) => s.name);
if (!scheduled.includes(name)) {
  console.error(`unknown job "${name}" — scheduled: ${scheduled.join(', ')}`);
  process.exitCode = 1;
} else {
  await queue.add(name, {});
  console.info(`queued ${name}`);
}
await queue.close();
await connection.quit();
