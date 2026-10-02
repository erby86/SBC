// Integration test against a real PostgreSQL 16. Runs only when TEST_DATABASE_URL is set
// (CI: build.yml `db-integration` job with a postgres service). The database must be empty.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createDbPool, type DbPool } from './index.js';
import { linksInNet, sitesInCore } from './schema/index.js';
import { loadMigrations, migrate } from './migrate.js';

const url = process.env['TEST_DATABASE_URL'];

describe.skipIf(!url)('schema v1.1 on PostgreSQL', () => {
  let pool: DbPool;

  beforeAll(async () => {
    pool = createDbPool(url ?? '');
    await migrate(pool, await loadMigrations());
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates every table of design v1.2 section 2', async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM information_schema.tables
       WHERE table_type = 'BASE TABLE'
         AND table_schema IN ('core','catalog','asset','net','viz','auth','ops','sync','audit')`,
    );
    expect(Number(rows[0]?.n)).toBe(61);
    const views = await pool.query(
      `SELECT 1 FROM information_schema.views WHERE table_schema = 'api'`,
    );
    expect(views.rowCount).toBe(5);
  });

  it('is idempotent', async () => {
    const result = await migrate(pool, await loadMigrations());
    expect(result.applied).toEqual([]);
  });

  it('issues LOC codes from 188 (ADR-0001)', async () => {
    const { rows } = await pool.query<{ code: string }>('SELECT core.next_loc_code() AS code');
    expect(rows[0]?.code).toMatch(/^LOC-(18[8-9]|19\d|[2-9]\d\d|\d{4,})$/);
  });

  it('bumps row_version and writes the audit log on update', async () => {
    const site = await pool.query<{ id: string }>(
      `INSERT INTO core.sites (code, name) VALUES ('it-test', 'Integration') RETURNING id`,
    );
    const id = site.rows[0]?.id;
    await pool.query(`UPDATE core.sites SET name = 'Integration 2' WHERE id = $1`, [id]);

    const after = await pool.query<{ row_version: number }>(
      'SELECT row_version FROM core.sites WHERE id = $1',
      [id],
    );
    expect(after.rows[0]?.row_version).toBe(2);

    const log = await pool.query<{ op: string }>(
      `SELECT op FROM audit.change_log WHERE table_name = 'core.sites' AND row_id = $1 ORDER BY id`,
      [id],
    );
    expect(log.rows.map((r) => r.op)).toEqual(['INSERT', 'UPDATE']);
  });

  it('seeds lookup tables', async () => {
    const roles = await pool.query('SELECT 1 FROM catalog.device_roles');
    expect(roles.rowCount).toBe(17);
    const sources = await pool.query(`SELECT 1 FROM core.source_systems WHERE code = 'zabbix'`);
    expect(sources.rowCount).toBe(1);
  });

  it('creates the application roles without login', async () => {
    const { rows } = await pool.query<{ rolname: string; rolcanlogin: boolean }>(
      `SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname LIKE 'noc\\_%' ORDER BY rolname`,
    );
    expect(rows).toEqual([
      { rolname: 'noc_app', rolcanlogin: false },
      { rolname: 'noc_migrate', rolcanlogin: false },
      { rolname: 'noc_read', rolcanlogin: false },
    ]);
  });
  it('rejects a second uplink for the same device (links_one_uplink)', async () => {
    const roles = await pool.query<{ id: string }>(
      `INSERT INTO net.devices (code, display_name, role_code)
       VALUES ('it-up-a', 'A', 'wan'), ('it-up-b', 'B', 'wan'), ('it-down', 'C', 'wan')
       RETURNING id`,
    );
    const [a, b, child] = roles.rows.map((r) => r.id);
    await pool.query(
      `INSERT INTO net.links (a_device_id, b_device_id, media_code) VALUES ($1, $2, 'fiber')`,
      [a, child],
    );
    await expect(
      pool.query(
        `INSERT INTO net.links (a_device_id, b_device_id, media_code) VALUES ($1, $2, 'fiber')`,
        [b, child],
      ),
    ).rejects.toThrow(/links_one_uplink/);

    // A non-uplink link to the same device is allowed.
    await pool.query(
      `INSERT INTO net.links (a_device_id, b_device_id, media_code, is_uplink) VALUES ($1, $2, 'fiber', false)`,
      [b, child],
    );
  });

  it('is queryable through the generated Drizzle schema', async () => {
    const db = drizzle(pool);
    const rows = await db.select().from(sitesInCore).where(eq(sitesInCore.code, 'it-test'));
    expect(rows[0]?.name).toBe('Integration 2');
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(linksInNet);
    expect(count?.n).toBe(2);
  });
});
