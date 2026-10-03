// M15 on the real seed (PostgreSQL 16): registry uplink tree + Zabbix refs from the database.
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
import { createStatusEngine, loadTopology } from './engine.js';

const url = process.env['TEST_DATABASE_URL'];
const SEED_DIR = fileURLToPath(new URL('../../../../infra/seed/', import.meta.url));

describe.skipIf(!url)('status engine on the registry', () => {
  const dbName = `sbc_noc_status_${Date.now()}`;
  let admin: DbPool;
  let db: DbPool;

  beforeAll(async () => {
    admin = createDbPool(url ?? '');
    await admin.query(`CREATE DATABASE ${dbName} TEMPLATE template0`);
    const target = new URL(url ?? '');
    target.pathname = `/${dbName}`;
    db = createDbPool(target.toString());
    await migrate(db, await loadMigrations());
    await importSeed(db, await readSeedFiles(SEED_DIR));
    // As M08 pairs them on dev: c1036 = Zabbix host 10085, m-s8 = 10088.
    await db.query(
      `INSERT INTO core.external_refs (entity_table, entity_id, system_code, external_id)
       SELECT 'net.devices', id, 'zabbix', CASE code WHEN 'c1036' THEN '10085' ELSE '10088' END
       FROM net.devices WHERE code IN ('c1036', 'm-s8')`,
    );
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin?.end();
  });

  it('reads the uplink tree without sample devices', async () => {
    const { topology, deviceOfHost } = await loadTopology(db);
    expect(topology).toHaveLength(49);
    expect(topology.find((d) => d.code === 'm-s8')?.uplink).toBe('c1036');
    expect(deviceOfHost.get('10085')).toBe('c1036');
  });

  it('turns a core switch problem into one incident with everything below cut off', async () => {
    const now = new Date();
    const stored = new Map<string, string>();
    const engine = createStatusEngine({
      db,
      zabbix: {
        problems: async () => [
          {
            eventid: '1',
            name: 'Unavailable by ICMP ping',
            severity: 4,
            clock: Math.floor(now.getTime() / 1000) - 60,
            hostids: ['10085'],
            acknowledged: false,
            ack: null,
          },
          // m-s8 reports its own ping problem too (Zabbix without M11 dependencies): it stays its
          // own incident, everything else below c1036 is cut.
          {
            eventid: '2',
            name: 'Unavailable by ICMP ping',
            severity: 4,
            clock: Math.floor(now.getTime() / 1000) - 50,
            hostids: ['10088', '55555'],
            acknowledged: false,
            ack: null,
          },
        ],
        hostsInMaintenance: async () => [],
      },
      store: { set: async (k, v) => stored.set(k, v), publish: async () => 1 },
      logger: { warn: () => undefined },
    });
    const snap = await engine.tick(now);
    expect(snap?.states['c1036']).toBe('down');
    expect(snap?.states['m-s8']).toBe('down');
    expect(snap?.states['sw-s8-a']).toBe('cut');
    expect(snap?.states['c2116']).toBeUndefined();
    expect(snap?.incidents.map((i) => i.device)).toEqual(['c1036', 'm-s8']);
    expect(snap?.incidents[0]?.impacted).toBe((snap?.counts.cut ?? 0) + 1); // cut + m-s8
    expect(JSON.parse(stored.get('status:snapshot') ?? '{}').lastUpdate).toBe(now.toISOString());
  });
});
