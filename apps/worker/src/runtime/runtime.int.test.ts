// M09 done-criteria test on real PostgreSQL 16 + Redis. Runs only with TEST_DATABASE_URL (CREATEDB)
// and TEST_REDIS_URL; uses its own database and Redis key prefix and removes both afterwards.
import { createDbPool, loadMigrations, migrate, type DbPool } from '@sbc-noc/db';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registryStats } from '../jobs/registry-stats.js';
import type { JobDefinition } from '../jobs/types.js';
import { startRuntime, type JobRuntime } from './queue.js';

const dbUrl = process.env['TEST_DATABASE_URL'];
const redisUrl = process.env['TEST_REDIS_URL'];
const quiet = { info: () => undefined, warn: () => undefined };

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.skipIf(!dbUrl || !redisUrl)('worker runtime (BullMQ + sync.runs)', () => {
  const stamp = Date.now();
  const dbName = `sbc_noc_worker_${stamp}`;
  const prefix = `noc:test:${stamp}:`;
  let admin: DbPool;
  let db: DbPool;
  let runtime: JobRuntime;
  let flakyCalls = 0;

  const flaky: JobDefinition = {
    name: 'flaky',
    systemCode: 'noc',
    schedule: { every: 60_000 },
    attempts: 3,
    async run({ issue }) {
      flakyCalls += 1;
      if (flakyCalls === 1) throw new Error('simulated outage');
      await issue({ kind: 'unmatched_host', message: 'example issue', externalId: 'host-1' });
      return { created: 1, detail: { calls: flakyCalls } };
    },
  };
  const ticker: JobDefinition = { ...registryStats, name: 'ticker', schedule: { every: 400 } };

  beforeAll(async () => {
    admin = createDbPool(dbUrl ?? '');
    await admin.query(`CREATE DATABASE ${dbName} TEMPLATE template0`);
    const target = new URL(dbUrl ?? '');
    target.pathname = `/${dbName}`;
    db = createDbPool(target.toString());
    await migrate(db, await loadMigrations());
    runtime = await startRuntime({
      redisUrl: redisUrl ?? '',
      redisPrefix: prefix,
      db,
      jobs: [flaky, ticker],
      logger: quiet,
      backoffMs: 50,
    });
  }, 60_000);

  afterAll(async () => {
    await runtime?.close();
    const r = new Redis(redisUrl ?? '');
    const keys = await r.keys(`${prefix}*`);
    if (keys.length) await r.del(...keys);
    await r.quit();
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin?.end();
  });

  it('runs a scheduled job repeatedly and records each run', async () => {
    const rows = await waitFor(async () => {
      const res = await db.query<{ status: string; detail: { devices: number } }>(
        `SELECT status, detail FROM sync.runs WHERE job = 'ticker' AND status = 'success'`,
      );
      return res.rows.length >= 2 ? res.rows : undefined;
    });
    expect(rows[0]?.detail.devices).toBe(0);
  });

  it('retries a failed job and records both attempts', async () => {
    const runs = await waitFor(async () => {
      const res = await db.query<{ status: string; attempt: number; error: string | null }>(
        `SELECT status, (detail->>'attempt')::int AS attempt, detail->>'error' AS error
         FROM sync.runs WHERE job = 'flaky' ORDER BY id`,
      );
      return res.rows.some((r) => r.status === 'success') ? res.rows : undefined;
    });
    expect(runs).toEqual([
      { status: 'failed', attempt: 1, error: 'simulated outage' },
      { status: 'success', attempt: 2, error: null },
    ]);
    const issues = await db.query(`SELECT kind, external_id FROM sync.issues`);
    expect(issues.rows).toEqual([{ kind: 'unmatched_host', external_id: 'host-1' }]);
  });

  it('keeps BullMQ keys under the noc prefix on the shared Redis', async () => {
    const r = new Redis(redisUrl ?? '');
    const keys = await r.keys(`${prefix}bull:*`);
    await r.quit();
    expect(keys.length).toBeGreaterThan(0);
  });
});
