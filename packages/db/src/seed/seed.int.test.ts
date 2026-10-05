// Imports the real infra/seed files into a fresh database, twice. Runs only with TEST_DATABASE_URL
// (needs CREATEDB): creates and drops its own database so it never collides with other tests.
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbPool, type DbPool } from '../index.js';
import { loadMigrations, migrate } from '../migrate.js';
import { readSeedFiles, type SeedFiles } from './files.js';
import { importSeed, type SeedReport } from './import.js';
import { applyPrototypeRoutes } from './routes.js';

const url = process.env['TEST_DATABASE_URL'];
const SEED_DIR = fileURLToPath(new URL('../../../../infra/seed/', import.meta.url));

describe.skipIf(!url)('M04 seed import', () => {
  const dbName = `sbc_noc_seed_${Date.now()}`;
  let admin: DbPool;
  let pool: DbPool;
  let seed: SeedFiles;
  let first: SeedReport;

  beforeAll(async () => {
    admin = createDbPool(url ?? '');
    await admin.query(`CREATE DATABASE ${dbName} TEMPLATE template0`);
    const target = new URL(url ?? '');
    target.pathname = `/${dbName}`;
    pool = createDbPool(target.toString());
    await migrate(pool, await loadMigrations());
    seed = await readSeedFiles(SEED_DIR);
    first = await importSeed(pool, seed);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin?.end();
  });

  it('row counts match the source files', () => {
    expect(first.actual).toEqual(first.expected);
    expect(first.expected).toMatchObject({
      buildings: 8,
      locations: 173,
      devices: 50,
      fiber_cables: 8,
      staff: 7,
    });
  });

  it('is idempotent: a second run writes nothing and adds no audit entries', async () => {
    const before = await pool.query<{ n: string }>('SELECT count(*) AS n FROM audit.change_log');
    const second = await importSeed(pool, seed);
    const after = await pool.query<{ n: string }>('SELECT count(*) AS n FROM audit.change_log');
    expect(second.written).toBe(0);
    expect(second.actual).toEqual(first.actual);
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('writes the prototype device positions and cable bends (M19)', async () => {
    const n = async (sql: string) => Number((await pool.query<{ n: string }>(sql)).rows[0]?.n);
    expect(await n('SELECT count(*) AS n FROM viz.device_placements')).toBe(
      seed.routes.placements.length,
    );
    expect(
      await n(`SELECT count(*) AS n FROM viz.link_routes WHERE waypoints <> '[]'::jsonb`),
    ).toBe(seed.routes.routes.length);
  });

  it('never overwrites a position or route someone already set (M19)', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN'); // rolled back: leaves no audit entries for the other tests
      await c.query(`UPDATE viz.device_placements SET u = 0.1 WHERE device_id =
        (SELECT id FROM net.devices WHERE code = 'm-s8')`);
      const r = await applyPrototypeRoutes(c, seed.routes);
      expect(r).toEqual({ placements: 0, routes: 0, missing: [] });
      const u = await c.query(`SELECT u FROM viz.device_placements WHERE device_id =
        (SELECT id FROM net.devices WHERE code = 'm-s8')`);
      expect(Number(u.rows[0]?.u)).toBe(0.1);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('keeps LOC-187 and gives SPORT-xx new LOC numbers from 188 (ADR-0001)', async () => {
    const server = await pool.query(`SELECT name FROM core.locations WHERE loc_code = 'LOC-187'`);
    expect(server.rows[0]).toEqual({ name: 'ห้อง server หลัก' });
    const sport = await pool.query<{ loc_code: string; legacy: string }>(
      `SELECT loc_code, attributes->>'legacy_code' AS legacy FROM core.locations
       WHERE attributes ? 'legacy_code' ORDER BY loc_code`,
    );
    expect(sport.rows).toEqual([
      { loc_code: 'LOC-188', legacy: 'SPORT-01' },
      { loc_code: 'LOC-189', legacy: 'SPORT-02' },
      { loc_code: 'LOC-190', legacy: 'SPORT-03' },
      { loc_code: 'LOC-191', legacy: 'SPORT-04' },
    ]);
  });

  it('exposes fiber cores and devices through the api views', async () => {
    const cables = await pool.query<{ code: string }>('SELECT code FROM net.cables ORDER BY code');
    expect(cables.rows.map((r) => r.code)).toContain('FO-B2-BA-01');
    const dev = await pool.query<{
      uplink_code: string;
      uplink_media: string;
      building_code: string;
    }>(`SELECT uplink_code, uplink_media, building_code FROM api.v_devices WHERE code = 'm-a4'`);
    expect(dev.rows[0]).toEqual({
      uplink_code: 'mainB',
      uplink_media: 'fiber',
      building_code: 'ba',
    });
  });

  it('records the importer as the audit actor', async () => {
    const { rows } = await pool.query<{ actor: string }>(
      'SELECT DISTINCT actor FROM audit.change_log',
    );
    expect(rows).toEqual([{ actor: 'seed:M04' }]);
  });
});
