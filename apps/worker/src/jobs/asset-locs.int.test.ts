// M05 on the real seed (PostgreSQL 16) with an SBC ASSET export built from infra/seed/areas.csv,
// which was taken from the same sheet. Own database; runs only with TEST_DATABASE_URL.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createDbPool,
  importSeed,
  loadMigrations,
  migrate,
  parseCsv,
  readSeedFiles,
  type DbPool,
} from '@sbc-noc/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssetLocRow, SbcAssetClient } from '../connectors/sbc-asset.js';
import { recordRun } from '../runtime/runs.js';
import { assetLocsJob } from './asset-locs.js';

const url = process.env['TEST_DATABASE_URL'];
const SEED_DIR = fileURLToPath(new URL('../../../../infra/seed/', import.meta.url));

function exportFromSeed(): AssetLocRow[] {
  const assetName = new Map(
    parseCsv(readFileSync(`${SEED_DIR}buildings.csv`, 'utf8')).map((b) => [
      b['รหัสอาคาร'] ?? '',
      b['ชื่อใน SBC ASSET'] ?? '',
    ]),
  );
  return parseCsv(readFileSync(`${SEED_DIR}areas.csv`, 'utf8'))
    .filter((r) => r['ที่มา'] === 'SBC ASSET')
    .map((r) => ({
      building: assetName.get(r['รหัสอาคาร'] ?? '') ?? '',
      floor: Number(r['ชั้น']),
      room: r['ห้อง / พื้นที่'] ?? '',
      loc: r['LOC'] ?? '',
      registry: r['เครื่องตาม Registry'] ? Number(r['เครื่องตาม Registry']) : null,
    }));
}

describe.skipIf(!url)('asset-locs job', () => {
  const dbName = `sbc_noc_asset_${Date.now()}`;
  let admin: DbPool;
  let db: DbPool;
  let rows: AssetLocRow[] = [];
  const job = assetLocsJob({ locations: async () => rows } satisfies SbcAssetClient);

  beforeAll(async () => {
    admin = createDbPool(url ?? '');
    await admin.query(`CREATE DATABASE ${dbName} TEMPLATE template0`);
    const target = new URL(url ?? '');
    target.pathname = `/${dbName}`;
    db = createDbPool(target.toString());
    await migrate(db, await loadMigrations());
    await importSeed(db, await readSeedFiles(SEED_DIR));
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin?.end();
  });

  const openIssues = async () =>
    (
      await db.query<{ kind: string; external_id: string }>(
        `SELECT kind, external_id FROM sync.issues WHERE system_code = 'sbc_asset' AND resolved_at IS NULL
         ORDER BY kind, external_id`,
      )
    ).rows;

  it('finds nothing to change when SBC ASSET matches the seed', async () => {
    rows = exportFromSeed();
    expect(rows).toHaveLength(172);
    const audit = async () =>
      Number((await db.query(`SELECT count(*) FROM audit.change_log`)).rows[0]?.count);
    const before = await audit();
    const result = await recordRun(db, job, 1);
    expect(result).toMatchObject({ created: 0, updated: 0, errors: 0 });
    expect(result.detail).toMatchObject({ asset_rows: 172, conflicts: 0, missing: 0 });
    expect(await audit()).toBe(before);
  });

  it('adds new rooms, follows PC counts and reports conflicts without overwriting', async () => {
    const base = exportFromSeed();
    rows = [
      ...base
        .filter((r) => r.loc !== 'LOC-002')
        .map((r) =>
          r.loc === 'LOC-001'
            ? { ...r, room: 'ห้องครูตุ๊ก (ใหม่)' }
            : r.loc === 'LOC-031'
              ? { ...r, registry: 42 }
              : r,
        ),
      { building: 'อาคาร 1', floor: 2, room: 'ห้องใหม่', loc: 'LOC-025', registry: 2 },
      { building: 'อาคาร 1', floor: 2, room: 'เลขเอง', loc: 'LOC-195', registry: 1 },
      { building: 'อาคาร 1', floor: 9, room: 'ชั้นไม่มี', loc: 'LOC-072', registry: 1 },
    ];
    const result = await recordRun(db, job, 1);
    expect(result).toMatchObject({ created: 1, updated: 2 }); // LOC-031 count + LOC-025 count
    expect(await openIssues()).toEqual([
      { kind: 'loc_conflict', external_id: 'LOC-001' },
      { kind: 'loc_conflict', external_id: 'LOC-072' },
      { kind: 'loc_conflict', external_id: 'LOC-195' },
      { kind: 'loc_missing', external_id: 'LOC-002' },
    ]);
    const kept = await db.query(`SELECT name FROM core.locations WHERE loc_code = 'LOC-001'`);
    expect(kept.rows[0]).toEqual({ name: 'ห้องครูตุ๊ก' });
    const added = await db.query(
      `SELECT l.owner_system, f.level, m.value FROM core.locations l JOIN core.floors f ON f.id = l.floor_id
       JOIN core.location_metrics m ON m.location_id = l.id WHERE l.loc_code = 'LOC-025'`,
    );
    expect(added.rows[0]).toEqual({ owner_system: 'sbc_asset', level: 2, value: '2' });
  });

  it('closes issues once SBC ASSET is fixed', async () => {
    rows = [
      ...exportFromSeed(),
      { building: 'อาคาร 1', floor: 2, room: 'ห้องใหม่', loc: 'LOC-025', registry: 2 },
    ];
    await recordRun(db, job, 1);
    expect(await openIssues()).toEqual([]);
  });

  it('fails instead of reporting every room missing on an empty export', async () => {
    rows = [];
    await expect(recordRun(db, job, 1)).rejects.toThrow('export has 0 rooms');
  });
});
