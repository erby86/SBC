// M06 on the real seed (PostgreSQL 16) with a fake UniFi that mirrors names seen on 2026-10-03.
// Own database; runs only with TEST_DATABASE_URL.
import { fileURLToPath } from 'node:url';
import {
  createDbPool,
  importSeed,
  loadMigrations,
  migrate,
  readSeedFiles,
  type DbPool,
} from '@sbc-noc/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UnifiClient, UnifiDevice } from '../connectors/unifi.js';
import { recordRun } from '../runtime/runs.js';
import { unifiApsJob } from './unifi-aps.js';

const url = process.env['TEST_DATABASE_URL'];
const SEED_DIR = fileURLToPath(new URL('../../../../infra/seed/', import.meta.url));

const ap = (
  name: string,
  mac: string,
  ip: string,
  model = 'U7LR',
  uplink: [string, number] | null = null,
): UnifiDevice => ({
  mac,
  name,
  model,
  type: 'uap',
  ip,
  version: '8.0.1',
  state: 1,
  uplinkMac: uplink?.[0] ?? null,
  uplinkPort: uplink?.[1] ?? null,
});

describe.skipIf(!url)('unifi-aps job', () => {
  const dbName = `sbc_noc_unifi_${Date.now()}`;
  let admin: DbPool;
  let db: DbPool;
  let devices: UnifiDevice[] = [];
  const fake: UnifiClient = { devices: async () => devices };
  const job = unifiApsJob(fake, { name: 'UniFi OS Server (172.16.0.30)', ip: '172.16.0.30' });

  beforeAll(async () => {
    admin = createDbPool(url ?? '');
    await admin.query(`CREATE DATABASE ${dbName} TEMPLATE template0`);
    const target = new URL(url ?? '');
    target.pathname = `/${dbName}`;
    db = createDbPool(target.toString());
    await migrate(db, await loadMigrations());
    await importSeed(db, await readSeedFiles(SEED_DIR));
    // As on dev: the sample AP was soft deleted (M07), its code stays reserved.
    await db.query(`UPDATE net.devices SET deleted_at = now() WHERE code = 'ap-ba-2-1'`);
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin?.end();
  });

  const openIssues = async () =>
    (
      await db.query<{ kind: string; external_id: string }>(
        `SELECT kind, external_id FROM sync.issues WHERE system_code = 'unifi' AND resolved_at IS NULL
         ORDER BY kind, external_id`,
      )
    ).rows;

  it('stores named APs on their floor and lists the rest for people', async () => {
    devices = [
      ap('8SFL2-1', 'fc:ec:da:34:b1:24', '172.16.0.72'),
      ap('A6-1', '78:8a:20:d3:12:a4', '172.16.0.208'),
      ap('A2-1', '78:8a:20:d3:00:01', '172.16.0.210'), // code ap-ba-2-1 is taken by the deleted sample
      ap('BFL3-1', '78:8a:20:00:00:31', '172.16.0.131'),
      ap('AC Mesh', '78:8a:20:00:00:99', '172.16.0.199', 'U7MSH'),
      ap('AC LR', '78:8a:20:50:1c:d5', '172.16.0.176', 'U7LR', ['00:00:00:00:00:04', 4]),
      { ...ap('US16BFL-4', '00:00:00:00:00:04', '172.16.0.24', 'US16P150'), type: 'usw' },
    ];
    const result = await recordRun(db, job, 1);
    expect(result.created).toBe(5);
    expect(result.detail).toMatchObject({
      controller_aps: 6,
      placed: 5,
      unplaced: 1,
      ip_conflicts: 0,
    });

    const rows = await db.query<{
      code: string;
      display_name: string;
      building: string;
      level: number;
      managed_by: string;
      model: string;
    }>(
      `SELECT d.code, d.display_name, b.code AS building, f.level, m.code AS managed_by, cm.name AS model
       FROM net.devices d JOIN core.floors f ON f.id = d.floor_id JOIN core.buildings b ON b.id = f.building_id
       JOIN net.devices m ON m.id = d.managed_by_device_id JOIN catalog.models cm ON cm.id = d.model_id
       WHERE d.role_code = 'ap' AND d.deleted_at IS NULL ORDER BY d.code`,
    );
    expect(rows.rows).toEqual([
      {
        code: 'ap-ba-2-1-0001',
        display_name: 'AP อาคาร A ชั้น 2 #1',
        building: 'ba',
        level: 2,
        managed_by: 'ctl-unifi',
        model: 'U7LR',
      },
      {
        code: 'ap-ba-6-1',
        display_name: 'AP อาคาร A ชั้น 6 #1',
        building: 'ba',
        level: 6,
        managed_by: 'ctl-unifi',
        model: 'U7LR',
      },
      {
        code: 'ap-bb-3-1',
        display_name: 'AP อาคาร B ชั้น 3 #1',
        building: 'bb',
        level: 3,
        managed_by: 'ctl-unifi',
        model: 'U7LR',
      },
      {
        code: 'ap-bb-4-p4',
        display_name: 'AP อาคาร B ชั้น 4 #p4',
        building: 'bb',
        level: 4,
        managed_by: 'ctl-unifi',
        model: 'U7LR',
      },
      {
        code: 'ap-s8-2-1',
        display_name: 'AP 8 เซียน ชั้น 2 #1',
        building: 's8',
        level: 2,
        managed_by: 'ctl-unifi',
        model: 'U7LR',
      },
    ]);
    const refs = await db.query(`SELECT 1 FROM core.external_refs WHERE system_code = 'unifi'`);
    expect(refs.rowCount).toBe(5);
    const uplink = await db.query(`SELECT attributes FROM net.devices WHERE code = 'ap-bb-4-p4'`);
    expect(uplink.rows[0]?.attributes).toMatchObject({
      floor_from: 'uplink',
      unifi_uplink: { device: 'US16BFL-4', port: 4 },
    });
    expect(await openIssues()).toEqual([{ kind: 'unplaced_ap', external_id: '78:8a:20:00:00:99' }]);
  });

  it('changes nothing on a second run with the same data', async () => {
    const audit = async () =>
      Number((await db.query(`SELECT count(*) FROM audit.change_log`)).rows[0]?.count);
    const before = await audit();
    const result = await recordRun(db, job, 1);
    expect(result).toMatchObject({ created: 0, updated: 0 });
    expect(await audit()).toBe(before);
    expect(await openIssues()).toHaveLength(1);
  });

  it('keeps a floor set by people, follows IP changes and resolves fixed issues', async () => {
    await db.query(
      `UPDATE net.devices SET floor_id = (SELECT f.id FROM core.floors f JOIN core.buildings b ON b.id = f.building_id
         WHERE b.code = 's8' AND f.level = 3) WHERE code = 'ap-s8-2-1'`,
    );
    devices = devices.map((d) =>
      d.name === '8SFL2-1'
        ? { ...d, ip: '172.16.0.172' }
        : d.name === 'AC Mesh'
          ? { ...d, name: 'BFL5-9' }
          : d,
    );
    const result = await recordRun(db, job, 1);
    expect(result).toMatchObject({ created: 1, updated: 1 });
    const s8 = await db.query<{ level: number; ip: string }>(
      `SELECT f.level, host(d.mgmt_ip) AS ip FROM net.devices d JOIN core.floors f ON f.id = d.floor_id
       WHERE d.code = 'ap-s8-2-1'`,
    );
    expect(s8.rows[0]).toEqual({ level: 3, ip: '172.16.0.172' });
    expect(await openIssues()).toEqual([]);
  });

  it('reports APs that left the controller', async () => {
    devices = devices.filter((d) => d.name !== 'A6-1');
    await recordRun(db, job, 1);
    expect(await openIssues()).toEqual([
      { kind: 'missing_in_controller', external_id: '78:8a:20:d3:12:a4' },
    ]);
  });
});
