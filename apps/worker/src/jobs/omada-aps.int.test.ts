// M06 (Omada) on the real seed (PostgreSQL 16): Omada APs live next to UniFi ones without
// touching each other's refs or issues. Own database; runs only with TEST_DATABASE_URL.
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
import type { OmadaClient, OmadaDevice } from '../connectors/omada.js';
import type { UnifiClient } from '../connectors/unifi.js';
import { recordRun } from '../runtime/runs.js';
import { omadaApsJob } from './omada-aps.js';
import { unifiApsJob } from './unifi-aps.js';

const url = process.env['TEST_DATABASE_URL'];
const SEED_DIR = fileURLToPath(new URL('../../../../infra/seed/', import.meta.url));

const ap = (name: string, mac: string, ip: string): OmadaDevice => ({
  mac,
  name,
  model: 'EAP615-Wall(US) v1.0',
  type: 'ap',
  ip,
  version: '1.0.0',
  status: 1,
  uplinkMac: null,
  uplinkPort: null,
});

describe.skipIf(!url)('omada-aps job', () => {
  const dbName = `sbc_noc_omada_${Date.now()}`;
  let admin: DbPool;
  let db: DbPool;
  let devices: OmadaDevice[] = [];
  const omada: OmadaClient = { devices: async () => devices };
  const job = omadaApsJob(omada, { name: 'Omada Controller (192.168.1.118)', ip: '192.168.1.118' });
  const unifi: UnifiClient = {
    devices: async () => [
      {
        mac: 'fc:ec:da:34:b1:24',
        name: '8SFL2-1',
        model: 'U7LR',
        type: 'uap',
        ip: '172.16.0.72',
        version: null,
        state: 1,
        uplinkMac: null,
        uplinkPort: null,
      },
    ],
  };

  beforeAll(async () => {
    admin = createDbPool(url ?? '');
    await admin.query(`CREATE DATABASE ${dbName} TEMPLATE template0`);
    const target = new URL(url ?? '');
    target.pathname = `/${dbName}`;
    db = createDbPool(target.toString());
    await migrate(db, await loadMigrations());
    await importSeed(db, await readSeedFiles(SEED_DIR));
    await recordRun(db, unifiApsJob(unifi, { name: 'UniFi', ip: null }), 1);
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin?.end();
  });

  it('places renamed APs, lists the rest and leaves UniFi alone', async () => {
    devices = [
      ap('1AP1', 'ec:75:0c:18:50:5a', '192.168.1.111'),
      ap('B2-1-1 GiftShop', 'ec:75:0c:18:4e:e4', '192.168.1.96'),
    ];
    const result = await recordRun(db, job, 1);
    expect(result).toMatchObject({ created: 1 });
    expect(result.detail).toMatchObject({ controller_aps: 2, placed: 1, unplaced: 1 });

    const rows = await db.query<{ code: string; managed_by: string; system: string }>(
      `SELECT d.code, m.code AS managed_by, x.system_code AS system
       FROM net.devices d JOIN net.devices m ON m.id = d.managed_by_device_id
       JOIN core.external_refs x ON x.entity_id = d.id
       WHERE d.role_code = 'ap' AND d.deleted_at IS NULL ORDER BY d.code`,
    );
    expect(rows.rows).toEqual([
      { code: 'ap-b2-1-1', managed_by: 'ctl-omada', system: 'omada' },
      { code: 'ap-s8-2-1', managed_by: 'ctl-unifi', system: 'unifi' },
    ]);
    const issues = await db.query<{ system_code: string; kind: string; external_id: string }>(
      `SELECT system_code, kind, external_id FROM sync.issues WHERE resolved_at IS NULL ORDER BY 1, 2`,
    );
    expect(issues.rows).toEqual([
      { system_code: 'omada', kind: 'unplaced_ap', external_id: 'ec:75:0c:18:50:5a' },
    ]);
    const attrs = await db.query(`SELECT attributes FROM net.devices WHERE code = 'ap-b2-1-1'`);
    expect(attrs.rows[0]?.attributes).toMatchObject({ source: 'omada', omada_uplink: null });
  });

  it('changes nothing on a second run', async () => {
    const result = await recordRun(db, job, 1);
    expect(result).toMatchObject({ created: 0, updated: 0 });
  });
});
