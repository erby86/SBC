// M08 part 1 on the real seed (PostgreSQL 16) with a fake Zabbix that mirrors the 8 hosts seen on
// 2026-10-02. Own database; runs only with TEST_DATABASE_URL.
import { fileURLToPath } from 'node:url';
import {
  createDbPool,
  importSeed,
  loadMigrations,
  migrate,
  readSeedFiles,
  runRegistryChecks,
  type DbPool,
} from '@sbc-noc/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ZabbixClient } from '../connectors/zabbix.js';
import { recordRun } from '../runtime/runs.js';
import { zabbixMatchJob } from './zabbix-match.js';

const url = process.env['TEST_DATABASE_URL'];
const SEED_DIR = fileURLToPath(new URL('../../../../infra/seed/', import.meta.url));

const HOSTS = [
  ['10084', 'MikroTik-CCR2116-MainRouter', '192.168.1.1'],
  ['10085', 'MikroTik-CCR1036-CoreSW', '192.168.1.2'],
  ['10086', 'TP-link-SG6428X-CoreSwitch-MainServ', '192.168.1.11'],
  ['10087', 'TP-Link-SG6428x-CoreSWB', '192.168.1.12'],
  ['10088', 'Tp-link-SG3428-Core-Main8M', '192.168.1.152'],
  ['10089', 'Link-PSG-5124A-CoreICET2', '192.168.1.21'],
  ['10090', 'Tp-link-SG3428-Core-Bldg1', '192.168.1.157'],
  ['10091', 'Tp-link-SG3428-Core-BldgICET1', '192.168.1.15'],
].map(([hostid, name, ip]) => ({
  hostid: hostid ?? '',
  host: name ?? '',
  name: name ?? '',
  ips: [ip ?? ''],
}));

describe.skipIf(!url)('zabbix-match job', () => {
  const dbName = `sbc_noc_zbx_${Date.now()}`;
  let admin: DbPool;
  let db: DbPool;
  const fake: ZabbixClient = {
    hosts: async () => HOSTS,
    hostsWithTags: async () => HOSTS.map((h) => ({ ...h, tags: [] })),
    setHostTags: async () => undefined,
    problems: async () => [],
    hostsInMaintenance: async () => [],
  };

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

  it('pairs the 5 hosts whose IP is in the registry and opens one issue per unknown host', async () => {
    const before =
      (await runRegistryChecks(db)).checks.find((c) => c.check === 'not_in_zabbix')?.count ?? 0;
    const result = await recordRun(db, zabbixMatchJob(fake), 1);
    expect(result.detail).toMatchObject({
      zabbix_hosts: 8,
      matched: 5,
      unmatched_hosts: 3,
      conflicts: 0,
    });

    const refs = await db.query<{ code: string; external_id: string }>(
      `SELECT d.code, x.external_id FROM core.external_refs x JOIN net.devices d ON d.id = x.entity_id
       WHERE x.system_code = 'zabbix' ORDER BY d.code`,
    );
    expect(refs.rows).toEqual([
      { code: 'c1036', external_id: '10085' },
      { code: 'c2116', external_id: '10084' },
      { code: 'm-i2', external_id: '10089' },
      { code: 'mainA', external_id: '10086' },
      { code: 'mainB', external_id: '10087' },
    ]);
    const after =
      (await runRegistryChecks(db)).checks.find((c) => c.check === 'not_in_zabbix')?.count ?? 0;
    expect(before - after).toBe(5);
  });

  it('does not duplicate open issues on the next run and resolves them once matched', async () => {
    await recordRun(db, zabbixMatchJob(fake), 1);
    const open = await db.query(
      `SELECT external_id FROM sync.issues WHERE resolved_at IS NULL ORDER BY external_id`,
    );
    expect(open.rows).toEqual([
      { external_id: '10088' },
      { external_id: '10090' },
      { external_id: '10091' },
    ]);

    // Give the Bldg1 switch its IP in the registry: next run pairs it and resolves its issue.
    await db.query(`UPDATE net.devices SET mgmt_ip = '192.168.1.157' WHERE code = 'm-b1'`);
    const r = await recordRun(db, zabbixMatchJob(fake), 1);
    expect(r.detail).toMatchObject({ matched: 6, unmatched_hosts: 2 });
    const resolved = await db.query(
      `SELECT 1 FROM sync.issues WHERE external_id = '10090' AND resolved_at IS NOT NULL`,
    );
    expect(resolved.rowCount).toBe(1);
  });
});
