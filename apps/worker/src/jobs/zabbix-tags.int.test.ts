// M08 part 2 on the real seed with an in-memory Zabbix: tags are written once, a second run changes
// nothing (done criterion), and tags not managed by the NOC survive. Runs only with TEST_DATABASE_URL.
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
import type { ZabbixClient, ZabbixTag, ZabbixTaggedHost } from '../connectors/zabbix.js';
import { recordRun } from '../runtime/runs.js';
import { zabbixTagsJob } from './zabbix-tags.js';

const url = process.env['TEST_DATABASE_URL'];
const SEED_DIR = fileURLToPath(new URL('../../../../infra/seed/', import.meta.url));

function memoryZabbix(hosts: ZabbixTaggedHost[]): ZabbixClient & { writes: number } {
  const store = new Map(hosts.map((h) => [h.hostid, h]));
  return {
    writes: 0,
    hosts: async () => [...store.values()],
    hostsWithTags: async () => [...store.values()].map((h) => ({ ...h, tags: [...h.tags] })),
    async setHostTags(hostid: string, tags: ZabbixTag[]) {
      this.writes += 1;
      const h = store.get(hostid);
      if (h) h.tags = tags;
    },
    problems: async () => [],
    hostsInMaintenance: async () => [],
    problemEvents: async () => [],
    hostsWithGroups: async () => [],
  };
}

describe.skipIf(!url)('zabbix-tags job', () => {
  const dbName = `sbc_noc_tags_${Date.now()}`;
  let admin: DbPool;
  let db: DbPool;
  const zbx = memoryZabbix([
    {
      hostid: '1',
      host: 'NOC-Test-CCR1036',
      name: 'x',
      ips: ['192.168.1.2'],
      tags: [{ tag: 'vendor', value: 'MikroTik' }],
    },
    { hostid: '2', host: 'NOC-Test-ICET2', name: 'y', ips: ['192.168.1.21'], tags: [] },
    { hostid: '3', host: 'NOC-Test-Unknown', name: 'z', ips: ['10.9.9.9'], tags: [] },
  ]);

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

  it('writes building/floor/loc/role/uplink from the registry and keeps foreign tags', async () => {
    const r = await recordRun(db, zabbixTagsJob(zbx, ['99-NOC-Test']), 1);
    expect(r.detail).toMatchObject({ hosts: 3, matched: 2, tags_updated: 2, no_position: 1 });
    const [ccr] = await zbx.hostsWithTags();
    expect(ccr?.tags).toEqual([
      { tag: 'vendor', value: 'MikroTik' },
      { tag: 'building', value: 'b2' },
      { tag: 'floor', value: '1' },
      { tag: 'loc', value: 'LOC-187' },
      { tag: 'role', value: 'core' },
      { tag: 'uplink', value: 'c2116' },
    ]);
  });

  it('changes nothing on a second run with the same data', async () => {
    const before = zbx.writes;
    const r = await recordRun(db, zabbixTagsJob(zbx, ['99-NOC-Test']), 1);
    expect(r.detail).toMatchObject({ tags_updated: 0, tags_unchanged: 2 });
    expect(zbx.writes).toBe(before);
  });
});
