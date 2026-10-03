// M07 checks on the real seed (PostgreSQL 16). Own database; runs only with TEST_DATABASE_URL.
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRegistryChecks } from './checks.js';
import { createDbPool, type DbPool } from './index.js';
import { loadMigrations, migrate } from './migrate.js';
import { readSeedFiles } from './seed/files.js';
import { importSeed } from './seed/import.js';

const url = process.env['TEST_DATABASE_URL'];
const SEED_DIR = fileURLToPath(new URL('../../../infra/seed/', import.meta.url));

describe.skipIf(!url)('M07 registry checks', () => {
  const dbName = `sbc_noc_checks_${Date.now()}`;
  let admin: DbPool;
  let pool: DbPool;

  beforeAll(async () => {
    admin = createDbPool(url ?? '');
    await admin.query(`CREATE DATABASE ${dbName} TEMPLATE template0`);
    const target = new URL(url ?? '');
    target.pathname = `/${dbName}`;
    pool = createDbPool(target.toString());
    await migrate(pool, await loadMigrations());
    await importSeed(pool, await readSeedFiles(SEED_DIR));
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin?.end();
  });

  const count = async (check: string) =>
    (await runRegistryChecks(pool)).checks.find((c) => c.check === check)?.count;

  it('reports the seeded registry: structure is consistent, Zabbix pairing and the sample row remain', async () => {
    const report = await runRegistryChecks(pool);
    const byCheck = Object.fromEntries(report.checks.map((c) => [c.check, c.count]));
    expect(byCheck).toMatchObject({
      no_position: 0,
      duplicate_ip: 0,
      uplink_missing: 0,
      uplink_cycle: 0,
    });
    expect(byCheck['sample_data']).toBe(1);
    expect(byCheck['not_in_zabbix']).toBeGreaterThan(0); // closed by M08
    expect(report.errors).toBe(
      report.checks.filter((c) => c.severity === 'error').reduce((n, c) => n + c.count, 0),
    );
  });

  it('detects an uplink loop', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // c2116 is the root; make it hang below one of its own descendants.
      await c.query(`INSERT INTO net.links (a_device_id, b_device_id, media_code)
                     SELECT (SELECT id FROM net.devices WHERE code = 'm-i2'), (SELECT id FROM net.devices WHERE code = 'c2116'), 'fiber'`);
      const report = await runRegistryChecks(c);
      const cycle = report.checks.find((x) => x.check === 'uplink_cycle');
      expect(cycle?.items.map((i) => i.code)).toContain('c2116');
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    expect(await count('uplink_cycle')).toBe(0);
  });

  it('detects an uplink to a deleted device', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`UPDATE net.devices SET deleted_at = now() WHERE code = 'm-sp'`);
      const report = await runRegistryChecks(c);
      const missing = report.checks.find((x) => x.check === 'uplink_missing');
      expect(missing?.items.map((i) => i.code)).toContain('sw-sp-1');
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('cannot hold a device without any position: the schema CHECK rejects it before the report has to', async () => {
    await expect(
      pool.query(`UPDATE net.devices SET floor_id = NULL, location_id = NULL WHERE code = 'm-b1'`),
    ).rejects.toThrow(/devices_check/);
    expect(await count('no_position')).toBe(0);
  });
});
