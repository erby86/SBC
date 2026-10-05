// Queue one run of a scheduled job now, e.g. after a deploy:
//   docker exec sbc-noc-dev-worker node dist/run-job-cli.js unifi-aps
// The running worker picks it up and records it in sync.runs like a scheduled run.
// M35 self-test: `--fail-test` queues one attempt that fails without doing anything
// (no retry), so the Zabbix trigger "NOC งานซิงก์ล้ม" can be checked end to end.
import { parseEnv, serverEnvSchema } from '@sbc-noc/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAME, type SyncJobData } from './runtime/queue.js';

const args = process.argv.slice(2);
const failTest = args.includes('--fail-test');
const name = args.find((a) => !a.startsWith('--'));
if (!name) {
  console.error(
    'usage: node dist/run-job-cli.js [--fail-test] <job name>  (registry-stats, zabbix-match, zabbix-tags, unifi-aps)',
  );
  process.exit(2);
}
const env = parseEnv(serverEnvSchema, process.env);
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue<SyncJobData>(QUEUE_NAME, { connection, prefix: `${env.REDIS_PREFIX}bull` });
const scheduled = (await queue.getJobSchedulers()).map((s) => s.name);
if (!scheduled.includes(name)) {
  console.error(`unknown job "${name}" — scheduled: ${scheduled.join(', ')}`);
  process.exitCode = 1;
} else {
  if (failTest) {
    await queue.add(
      name,
      { failTest: true },
      { attempts: 1, removeOnComplete: 100, removeOnFail: 500 },
    );
    console.info(`queued ${name} (self-test: this run fails on purpose)`);
  } else {
    await queue.add(name, {});
    console.info(`queued ${name}`);
  }
}
await queue.close();
await connection.quit();
