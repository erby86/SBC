// M21 edits on the real seed (PostgreSQL 16): row_version guard, checks before saving, uplink loops,
// audit trail, LOC numbering and placing an unplaced AP. Own database; runs only with TEST_DATABASE_URL.
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbPool, type DbPool } from '../index.js';
import { loadMigrations, migrate } from '../migrate.js';
import { readSeedFiles } from '../seed/files.js';
import { importSeed } from '../seed/import.js';
import { getDevice, listDevices } from './read.js';
import type { DeviceEdit } from '@sbc-noc/shared';
import {
  createDevice,
  createLocation,
  deleteDevice,
  getDeviceEdit,
  getEditOptions,
  getHistory,
  getLocationEdit,
  listUnplacedAps,
  placeUnplacedAp,
  RegistryEditError,
  updateDevice,
  updateLocation,
} from './write.js';

const url = process.env['TEST_DATABASE_URL'];
const SEED_DIR = fileURLToPath(new URL('../../../../infra/seed/', import.meta.url));
const ACTOR = 'web:STF-01@192.168.1.50';

async function loaded(db: DbPool, code: string): Promise<DeviceEdit> {
  const d = await getDeviceEdit(db, code);
  if (!d) throw new Error(`missing ${code}`);
  return d;
}

async function expectEditError(p: Promise<unknown>, kind: string, field?: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RegistryEditError);
  expect((err as RegistryEditError).kind).toBe(kind);
  if (field) expect((err as RegistryEditError).field).toBe(field);
}

describe.skipIf(!url)('registry editor (M21)', () => {
  const dbName = `sbc_noc_edit_${Date.now()}`;
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

  it('offers roles, media, room types, buildings with floors and models', async () => {
    const o = await getEditOptions(db);
    expect(o.roles.map((r) => r.code)).toContain('ap');
    expect(o.buildings.find((b) => b.code === 's8')?.floors).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(o.media.map((m) => m.code)).toContain('fiber');
  });

  it('updates a device, bumps row_version, records who did it and refuses a stale copy', async () => {
    const before = await loaded(db, 'm-s8');
    const after = await updateDevice(
      db,
      'm-s8',
      { rowVersion: before.rowVersion, ip: '192.168.1.152', name: '8 เซียน main (SG3428)' },
      ACTOR,
    );
    expect(after).toMatchObject({
      ip: '192.168.1.152',
      name: '8 เซียน main (SG3428)',
      rowVersion: before.rowVersion + 1,
    });
    await expectEditError(
      updateDevice(db, 'm-s8', { rowVersion: before.rowVersion, name: 'x' }, ACTOR),
      'conflict',
    );
    const h = await getHistory(db, 'device', 'm-s8');
    expect(h[0]).toMatchObject({ actor: ACTOR, op: 'UPDATE' });
    expect(h[0]?.changes.map((c) => c.field).sort()).toEqual(['display_name', 'mgmt_ip']);
  });

  it('checks before saving: duplicate IP, unknown room or floor, uplink loops', async () => {
    const sw = await loaded(db, 'sw-s8-a');
    await expectEditError(
      updateDevice(db, 'sw-s8-a', { rowVersion: sw.rowVersion, ip: '192.168.1.1' }, ACTOR),
      'invalid',
      'ip',
    );
    await expectEditError(
      updateDevice(db, 'sw-s8-a', { rowVersion: sw.rowVersion, locCode: 'LOC-999' }, ACTOR),
      'invalid',
      'locCode',
    );
    await expectEditError(
      updateDevice(
        db,
        'sw-s8-a',
        { rowVersion: sw.rowVersion, locCode: null, building: 's8', floor: 12 },
        ACTOR,
      ),
      'invalid',
      'floor',
    );
    const core = await loaded(db, 'c1036');
    await expectEditError(
      updateDevice(db, 'c1036', { rowVersion: core.rowVersion, uplink: 'sw-s8-a' }, ACTOR),
      'invalid',
      'uplink',
    );
    await expectEditError(
      updateDevice(db, 'c1036', { rowVersion: core.rowVersion, uplink: 'c1036' }, ACTOR),
      'invalid',
      'uplink',
    );
    // nothing was written by the refused edits
    expect((await loaded(db, 'sw-s8-a')).rowVersion).toBe(sw.rowVersion);
  });

  it('moves a device into a room and re-points its uplink', async () => {
    const sw = await loaded(db, 'sw-s8-a');
    const moved = await updateDevice(
      db,
      'sw-s8-a',
      { rowVersion: sw.rowVersion, locCode: 'LOC-045', uplink: 'mainB', uplinkMedia: 'fiber' },
      ACTOR,
    );
    expect(moved).toMatchObject({
      locCode: 'LOC-045',
      building: 's8',
      floor: 5,
      uplink: 'mainB',
      uplinkMedia: 'fiber',
    });
    expect((await getDevice(db, 'mainB'))?.downlinks.map((d) => d.code)).toContain('sw-s8-a');
    expect((await getDevice(db, 'm-s8'))?.downlinks.map((d) => d.code)).not.toContain('sw-s8-a');
  });

  it('creates and soft-deletes devices; codes are never reused', async () => {
    const d = await createDevice(
      db,
      {
        code: 'sw-b1-3',
        name: 'อาคาร 1 ชั้น 3',
        role: 'access',
        building: 'b1',
        floor: 3,
        locCode: null,
        uplink: 'm-b1',
        uplinkMedia: 'copper',
        hostname: null,
        model: 'TL-SG1218MPE',
        ip: null,
        mac: null,
        lifecycle: 'active',
        dataStatus: 'unverified',
      },
      ACTOR,
    );
    expect(d).toMatchObject({
      code: 'sw-b1-3',
      building: 'b1',
      floor: 3,
      uplink: 'm-b1',
      model: 'TL-SG1218MPE',
    });
    await deleteDevice(db, 'sw-b1-3', d.rowVersion, ACTOR);
    expect(await getDeviceEdit(db, 'sw-b1-3')).toBeNull();
    await expectEditError(
      createDevice(
        db,
        {
          ...d,
          code: 'sw-b1-3',
          hostname: null,
          model: null,
          ip: null,
          mac: null,
          uplink: null,
          uplinkMedia: null,
          dataStatus: 'unverified',
        },
        ACTOR,
      ),
      'invalid',
      'code',
    );
  });

  it('issues the next LOC number for a new room and edits rooms with the same guard', async () => {
    const room = await createLocation(
      db,
      {
        building: 'b1',
        floor: 3,
        name: 'ห้องทดสอบ',
        roomNumber: '1309',
        type: 'classroom',
        corridorOrder: 9,
        side: 'north',
        hasRack: false,
      },
      ACTOR,
    );
    expect(room.locCode).toBe('LOC-192'); // 188–191 went to SPORT-01..04 (ADR-0001)
    const edited = await updateLocation(
      db,
      'LOC-192',
      { rowVersion: room.rowVersion, corridorOrder: 2 },
      ACTOR,
    );
    expect(edited.corridorOrder).toBe(2);
    await expectEditError(
      updateLocation(db, 'LOC-192', { rowVersion: room.rowVersion, name: 'x' }, ACTOR),
      'conflict',
    );
    expect((await getLocationEdit(db, 'LOC-031'))?.owner).toBe('sbc_asset');
  });

  it('places an AP from the unplaced list; the controller import will find it by MAC', async () => {
    await db.query(
      `INSERT INTO net.devices (code, display_name, role_code) VALUES ('ctl-unifi', 'UniFi', 'controller');
       INSERT INTO sync.issues (system_code, kind, external_id, message)
       VALUES ('unifi', 'unplaced_ap', '78:8a:20:50:1c:d5',
               'AP "AC LR" (78:8a:20:50:1c:d5, 172.16.0.176): ชื่อไม่บอกอาคาร/ชั้น')`,
    );
    // one AP of the same system already managed by ctl-unifi
    await db.query(
      `UPDATE net.devices SET managed_by_device_id = (SELECT id FROM net.devices WHERE code = 'ctl-unifi')
       WHERE code = 'sw-bb-4';
       INSERT INTO core.external_refs (entity_table, entity_id, system_code, external_id)
       SELECT 'net.devices', id, 'unifi', 'fc:ec:da:00:00:01' FROM net.devices WHERE code = 'sw-bb-4'`,
    );
    expect(await listUnplacedAps(db)).toEqual([
      expect.objectContaining({
        system: 'unifi',
        mac: '78:8a:20:50:1c:d5',
        name: 'AC LR',
        ip: '172.16.0.176',
      }),
    ]);
    const ap = await placeUnplacedAp(
      db,
      'unifi',
      '78:8a:20:50:1c:d5',
      { building: 'bb', floor: 4, locCode: null, no: null },
      ACTOR,
    );
    expect(ap).toMatchObject({
      code: 'ap-bb-4-1',
      role: 'ap',
      building: 'bb',
      floor: 4,
      ip: '172.16.0.176',
      managedBy: 'ctl-unifi',
    });
    expect(await listUnplacedAps(db)).toEqual([]);
    expect(
      (await listDevices(db, { building: 'bb', floor: 4, role: 'ap' })).map((d) => d.code),
    ).toEqual(['ap-bb-4-1']);
    await expectEditError(
      placeUnplacedAp(
        db,
        'unifi',
        '78:8a:20:50:1c:d5',
        { building: 'bb', floor: 4, locCode: null, no: null },
        ACTOR,
      ),
      'not_found',
    );
  });
});
