// M35 sync job health from sync.runs (PostgreSQL 16). Own database; runs only with TEST_DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbPool, type DbPool } from './index.js';
import { loadMigrations, migrate } from './migrate.js';
import { readSyncHealth } from './selfmon.js';

const url = process.env['TEST_DATABASE_URL'];

describe.skipIf(!url)('M35 sync job health', () => {
  const dbName = `sbc_noc_selfmon_${Date.now()}`;
  let admin: DbPool;
  let pool: DbPool;

  beforeAll(async () => {
    admin = createDbPool(url ?? '');
    await admin.query(`CREATE DATABASE ${dbName} TEMPLATE template0`);
    const target = new URL(url ?? '');
    target.pathname = `/${dbName}`;
    pool = createDbPool(target.toString());
    await migrate(pool, await loadMigrations());
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin?.end();
  });

  const run = (job: string, status: string, minutesAgo: number, finished = true) =>
    pool.query(
      `INSERT INTO sync.runs (system_code, job, status, started_at, finished_at)
       VALUES ('noc', $1, $2, now() - make_interval(mins => $3),
               CASE WHEN $4 THEN now() - make_interval(mins => $3) + interval '10 seconds' END)`,
      [job, status, minutesAgo, finished],
    );

  it('reports failing, recovered, running and interrupted jobs', async () => {
    // ok-job: failed then succeeded -> healthy
    await run('ok-job', 'failed', 20);
    await run('ok-job', 'success', 10);
    // bad-job: success, then two failed attempts -> failing, 2 since success
    await run('bad-job', 'success', 60);
    await run('bad-job', 'failed', 5);
    await run('bad-job', 'failed', 4);
    // slow-job: success, then interrupted by a restart, then one still running
    await run('slow-job', 'success', 30);
    await run('slow-job', 'interrupted', 25);
    await run('slow-job', 'running', 15, false);
    // old-job: outside the 7-day window
    await run('old-job', 'failed', 8 * 24 * 60);

    const health = await readSyncHealth(pool);
    expect(health.map((h) => h.job)).toEqual(['bad-job', 'ok-job', 'slow-job']);
    const [bad, ok, slow] = health;
    expect(bad).toMatchObject({ lastFailed: true, failedSinceSuccess: 2 });
    expect(bad?.lastSuccessAgeSeconds).toBeGreaterThan(59 * 60);
    expect(bad?.runningSeconds).toBeNull();
    expect(ok).toMatchObject({ lastFailed: false, failedSinceSuccess: 0, runningSeconds: null });
    expect(slow).toMatchObject({ lastFailed: false, failedSinceSuccess: 0 });
    expect(slow?.runningSeconds).toBeGreaterThan(14 * 60);
  });
});
