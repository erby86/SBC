// M14 reads on the real seed (PostgreSQL 16). Every result is parsed with the shared zod schema,
// so the api contract is checked against real rows. Own database; runs only with TEST_DATABASE_URL.
import {
  buildingDetailSchema,
  deviceDetailSchema,
  layoutSchema,
  searchHitSchema,
} from '@sbc-noc/shared';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbPool, type DbPool } from '../index.js';
import { loadMigrations, migrate } from '../migrate.js';
import { readSeedFiles } from '../seed/files.js';
import { importSeed } from '../seed/import.js';
import {
  getBuilding,
  getDevice,
  getLayout,
  getLocation,
  listDevices,
  listLocations,
  search,
} from './read.js';

const url = process.env['TEST_DATABASE_URL'];
const SEED_DIR = fileURLToPath(new URL('../../../../infra/seed/', import.meta.url));

describe.skipIf(!url)('registry reads (M14)', () => {
  const dbName = `sbc_noc_read_${Date.now()}`;
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
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin?.end();
  });

  it('returns the whole 3D layout in the shared schema', async () => {
    const layout = layoutSchema.parse(await getLayout(db));
    expect(layout.site.code).toBe('sbc');
    expect(layout.buildings.map((b) => b.code).sort()).toEqual([
      'b1',
      'b2',
      'ba',
      'bb',
      'i1',
      'i2',
      's8',
      'sp',
    ]);
    expect(layout.buildings.every((b) => b.shape !== null)).toBe(true);
    expect(layout.locations).toHaveLength(173);
    expect(layout.devices).toHaveLength(49); // 50 seed devices minus the sample AP
    expect(layout.devices.some((d) => d.dataStatus === 'sample')).toBe(false);
    expect(layout.cables).toHaveLength(8);
    const fiber = layout.links.find((l) => l.b === 'm-b1');
    expect(fiber).toMatchObject({
      a: 'c1036',
      media: 'fiber',
      cable: 'FO-B2-B1-01',
      color: '#00e5ff',
      lane: null,
    });
    // cable bends of the prototype (M19), [x, y, z]
    expect(fiber?.waypoints.length).toBeGreaterThan(0);
    expect(fiber?.waypoints.every((w) => w.length === 3)).toBe(true);
    expect(layout.devices.find((d) => d.code === 'c2116')?.placement).toMatchObject({
      mode: 'manual',
      u: 0.26,
      v: 0,
    });
  });

  it('gives a building with per-floor counts', async () => {
    const b2 = buildingDetailSchema.parse(await getBuilding(db, 'b2'));
    expect(b2.floors.map((f) => f.level)).toEqual([1, 2, 3]);
    expect(b2.floors[0]?.devices).toBeGreaterThan(0);
    expect(await getBuilding(db, 'nope')).toBeNull();
  });

  it('filters rooms and devices and carries SBC ASSET PC counts', async () => {
    const lab = await getLocation(db, 'LOC-031');
    expect(lab).toMatchObject({ building: 'b2', floor: 3, registryPcCount: 40 });
    const s8f5 = await listLocations(db, { building: 's8', floor: 5 });
    expect(s8f5.map((l) => l.locCode)).toContain('LOC-045');
    expect(s8f5.every((l) => l.building === 's8' && l.floor === 5)).toBe(true);
    const cores = await listDevices(db, { role: 'core' });
    expect(cores.map((d) => d.code)).toEqual(expect.arrayContaining(['c2116', 'c1036']));
  });

  it('details a device with its downlinks', async () => {
    const c2116 = deviceDetailSchema.parse(await getDevice(db, 'c2116'));
    expect(c2116).toMatchObject({
      ip: '192.168.1.1',
      building: 'b2',
      locCode: 'LOC-187',
      uplink: null,
    });
    expect(c2116.downlinks.map((d) => d.code)).toContain('c1036');
    expect(await getDevice(db, 'ap-ba-2-1')).toBeNull(); // sample
  });

  it('searches buildings, rooms and devices with exact matches first', async () => {
    const hits = async (q: string) => (await search(db, q, 5)).map((h) => searchHitSchema.parse(h));
    expect((await hits('192.168.1.1'))[0]).toMatchObject({
      kind: 'device',
      code: 'c2116',
      match: 'IP 192.168.1.1',
    });
    expect((await hits('loc-031'))[0]).toMatchObject({ kind: 'location', code: 'LOC-031' });
    expect((await hits('2310'))[0]).toMatchObject({
      kind: 'location',
      code: 'LOC-031',
      match: 'ห้องคอม 2310',
    });
    expect((await hits('icet')).slice(0, 2).map((h) => h.code)).toEqual(['i1', 'i2']);
    expect(await hits('100%_')).toEqual([]);
    expect(await hits('   ')).toEqual([]);
  });
});
