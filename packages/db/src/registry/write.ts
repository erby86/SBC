// M21: registry edits (ADR-0020). Every change runs in one transaction with app.actor set, so the
// audit triggers record who changed what; row_version (bumped by core.touch_row) refuses edits
// based on an old copy. Checks happen before saving and fail with a field name for the form.
import type {
  DeviceCreate,
  DeviceEdit,
  DevicePatch,
  EditOptions,
  HistoryEntry,
  LocationCreate,
  LocationEdit,
  LocationPatch,
  PlaceAp,
  UnplacedAp,
} from '@sbc-noc/shared';
import type pg from 'pg';

export class RegistryEditError extends Error {
  constructor(
    public readonly kind: 'not_found' | 'conflict' | 'invalid',
    message: string,
    public readonly field?: string,
  ) {
    super(message);
  }
}

type Client = pg.PoolClient;

async function inTx<T>(pool: pg.Pool, actor: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.actor', $1, true)`, [actor]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

const invalid = (field: string, message: string) =>
  new RegistryEditError('invalid', message, field);

// ---------- options ----------

export async function getEditOptions(db: pg.Pool): Promise<EditOptions> {
  const [roles, media, types, floors, models] = await Promise.all([
    db.query<{ code: string; name: string; layer: string }>(
      'SELECT code, name, layer FROM catalog.device_roles ORDER BY layer, code',
    ),
    db.query<{ code: string; name: string }>('SELECT code, name FROM net.link_media ORDER BY code'),
    db.query<{ code: string; name: string }>(
      'SELECT code, name FROM core.location_types ORDER BY name',
    ),
    db.query<{ code: string; name: string; level: number }>(
      `SELECT b.code, b.name, f.level::int FROM core.buildings b JOIN core.floors f ON f.building_id = b.id
       WHERE b.deleted_at IS NULL ORDER BY b.code, f.level`,
    ),
    db.query<{ name: string }>('SELECT DISTINCT name FROM catalog.models ORDER BY name'),
  ]);
  const buildings = new Map<string, { code: string; name: string; floors: number[] }>();
  for (const r of floors.rows) {
    const b = buildings.get(r.code) ?? { code: r.code, name: r.name, floors: [] };
    b.floors.push(r.level);
    buildings.set(r.code, b);
  }
  return {
    roles: roles.rows,
    media: media.rows,
    locationTypes: types.rows,
    buildings: [...buildings.values()],
    models: models.rows.map((m) => m.name),
  };
}

// ---------- devices ----------

const DEVICE_EDIT_SQL = `
  SELECT d.id, d.code, d.display_name, d.hostname, d.role_code, m.name AS model, l.loc_code,
         b.code AS building, coalesce(f.level, lf.level)::int AS floor, host(d.mgmt_ip) AS ip, d.mac::text AS mac,
         up.code AS uplink, k.media_code AS uplink_media, d.lifecycle, d.data_status, mg.code AS managed_by,
         d.row_version
  FROM net.devices d
  LEFT JOIN catalog.models m ON m.id = d.model_id
  LEFT JOIN core.locations l ON l.id = d.location_id
  LEFT JOIN core.floors lf ON lf.id = l.floor_id
  LEFT JOIN core.floors f ON f.id = d.floor_id
  LEFT JOIN core.buildings b ON b.id = coalesce(f.building_id, lf.building_id)
  LEFT JOIN net.links k ON k.b_device_id = d.id AND k.is_uplink AND k.deleted_at IS NULL
  LEFT JOIN net.devices up ON up.id = k.a_device_id
  LEFT JOIN net.devices mg ON mg.id = d.managed_by_device_id
  WHERE d.code = $1 AND d.deleted_at IS NULL`;

interface DeviceEditRow {
  id: string;
  code: string;
  display_name: string;
  hostname: string | null;
  role_code: string;
  model: string | null;
  loc_code: string | null;
  building: string | null;
  floor: number | null;
  ip: string | null;
  mac: string | null;
  uplink: string | null;
  uplink_media: string | null;
  lifecycle: DeviceEdit['lifecycle'];
  data_status: DeviceEdit['dataStatus'];
  managed_by: string | null;
  row_version: number;
}

const toDeviceEdit = (r: DeviceEditRow): DeviceEdit => ({
  code: r.code,
  name: r.display_name,
  hostname: r.hostname,
  role: r.role_code,
  model: r.model,
  locCode: r.loc_code,
  building: r.building,
  floor: r.floor,
  ip: r.ip,
  mac: r.mac,
  uplink: r.uplink,
  uplinkMedia: r.uplink_media,
  lifecycle: r.lifecycle,
  dataStatus: r.data_status,
  managedBy: r.managed_by,
  rowVersion: r.row_version,
});

export async function getDeviceEdit(
  db: pg.Pool | Client,
  code: string,
): Promise<DeviceEdit | null> {
  const { rows } = await db.query<DeviceEditRow>(DEVICE_EDIT_SQL, [code]);
  return rows[0] ? toDeviceEdit(rows[0]) : null;
}

/** Where a device sits: a room (its floor follows) or a building floor. */
async function resolvePlace(
  c: Client,
  p: { locCode?: string | null; building?: string | null; floor?: number | null },
): Promise<{ locationId: string | null; floorId: string | null }> {
  if (p.locCode) {
    const r = await c.query<{ id: string }>(
      'SELECT id FROM core.locations WHERE loc_code = $1 AND deleted_at IS NULL',
      [p.locCode],
    );
    if (!r.rows[0]) throw invalid('locCode', `ไม่มีห้อง ${p.locCode}`);
    return { locationId: r.rows[0].id, floorId: null };
  }
  if (p.building && p.floor !== null && p.floor !== undefined) {
    const r = await c.query<{ id: string }>(
      `SELECT f.id FROM core.floors f JOIN core.buildings b ON b.id = f.building_id
       WHERE b.code = $1 AND f.level = $2`,
      [p.building, p.floor],
    );
    if (!r.rows[0]) throw invalid('floor', `อาคาร ${p.building} ไม่มีชั้น ${p.floor}`);
    return { locationId: null, floorId: r.rows[0].id };
  }
  return { locationId: null, floorId: null };
}

async function modelId(c: Client, name: string | null): Promise<number | null> {
  if (!name) return null;
  const found = await c.query<{ id: number }>(
    'SELECT id FROM catalog.models WHERE name = $1 ORDER BY id LIMIT 1',
    [name],
  );
  if (found.rows[0]) return found.rows[0].id;
  const ins = await c.query<{ id: number }>(
    `INSERT INTO catalog.models (name, kind) VALUES ($1, 'other') RETURNING id`,
    [name],
  );
  return ins.rows[0]?.id ?? null;
}

async function checkIp(c: Client, ip: string | null, selfId: string | null): Promise<void> {
  if (!ip) return;
  const r = await c.query<{ code: string }>(
    `SELECT code FROM net.devices WHERE mgmt_ip = $1::inet AND deleted_at IS NULL AND id IS DISTINCT FROM $2`,
    [ip, selfId],
  );
  if (r.rows[0]) throw invalid('ip', `IP ${ip} เป็นของ ${r.rows[0].code} อยู่แล้ว`);
}

async function checkRole(c: Client, role: string): Promise<void> {
  const r = await c.query('SELECT 1 FROM catalog.device_roles WHERE code = $1', [role]);
  if (!r.rowCount) throw invalid('role', `ไม่มีบทบาท ${role}`);
}

/** Point the device's uplink at `uplink` (code) — refusing self, unknown devices and loops. */
async function setUplink(
  c: Client,
  deviceId: string,
  code: string,
  uplink: string | null,
  media: string | null,
): Promise<void> {
  const current = await c.query<{ id: string; a: string; media_code: string }>(
    `SELECT k.id, up.code AS a, k.media_code FROM net.links k JOIN net.devices up ON up.id = k.a_device_id
     WHERE k.b_device_id = $1 AND k.is_uplink AND k.deleted_at IS NULL`,
    [deviceId],
  );
  const cur = current.rows[0];
  if (!uplink) {
    if (cur) await c.query('UPDATE net.links SET deleted_at = now() WHERE id = $1', [cur.id]);
    return;
  }
  if (uplink === code) throw invalid('uplink', 'ต่อเข้าตัวเองไม่ได้');
  const up = await c.query<{ id: string }>(
    'SELECT id FROM net.devices WHERE code = $1 AND deleted_at IS NULL',
    [uplink],
  );
  const upId = up.rows[0]?.id;
  if (!upId) throw invalid('uplink', `ไม่มีอุปกรณ์ ${uplink}`);
  // Walk up from the new uplink: meeting this device again would make a loop.
  const loop = await c.query(
    `WITH RECURSIVE chain(id, depth) AS (
       SELECT $1::uuid, 0
       UNION ALL
       SELECT k.a_device_id, chain.depth + 1 FROM chain
       JOIN net.links k ON k.b_device_id = chain.id AND k.is_uplink AND k.deleted_at IS NULL
       WHERE chain.depth < 50)
     SELECT 1 FROM chain WHERE id = $2`,
    [upId, deviceId],
  );
  if (loop.rowCount) throw invalid('uplink', `${uplink} อยู่ใต้ ${code} อยู่แล้ว — จะเกิดวงวน`);
  const mediaCode = media ?? cur?.media_code ?? 'copper';
  const m = await c.query('SELECT 1 FROM net.link_media WHERE code = $1', [mediaCode]);
  if (!m.rowCount) throw invalid('uplinkMedia', `ไม่มีชนิดสาย ${mediaCode}`);
  if (cur && cur.a === uplink) {
    if (cur.media_code !== mediaCode) {
      await c.query('UPDATE net.links SET media_code = $2 WHERE id = $1', [cur.id, mediaCode]);
    }
    return;
  }
  if (cur) await c.query('UPDATE net.links SET deleted_at = now() WHERE id = $1', [cur.id]);
  await c.query(
    `INSERT INTO net.links (a_device_id, b_device_id, media_code, is_uplink) VALUES ($1, $2, $3, true)`,
    [upId, deviceId, mediaCode],
  );
}

const placeFieldsChanged = (p: DevicePatch) =>
  p.locCode !== undefined || p.building !== undefined || p.floor !== undefined;

export async function updateDevice(
  pool: pg.Pool,
  code: string,
  patch: DevicePatch,
  actor: string,
): Promise<DeviceEdit> {
  return inTx(pool, actor, async (c) => {
    const { rows } = await c.query<DeviceEditRow>(`${DEVICE_EDIT_SQL} FOR UPDATE OF d`, [code]);
    const row = rows[0];
    if (!row) throw new RegistryEditError('not_found', `ไม่พบอุปกรณ์ ${code}`);
    if (row.row_version !== patch.rowVersion) {
      throw new RegistryEditError(
        'conflict',
        'มีคนแก้อุปกรณ์นี้ไปก่อนแล้ว — โหลดข้อมูลใหม่แล้วแก้อีกครั้ง',
      );
    }
    const cur = toDeviceEdit(row);
    const next = {
      ...cur,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    };
    if (patch.role !== undefined) await checkRole(c, next.role);
    if (patch.ip !== undefined) await checkIp(c, next.ip, row.id);
    let place: { locationId: string | null; floorId: string | null } | null = null;
    if (placeFieldsChanged(patch)) {
      place = await resolvePlace(c, next.locCode ? { locCode: next.locCode } : next);
      if (!place.locationId && !place.floorId && !['wan', 'controller'].includes(next.role)) {
        throw invalid('floor', 'ต้องเลือกห้อง หรืออาคาร + ชั้น');
      }
    }
    const sets: string[] = [];
    const vals: unknown[] = [row.id];
    const set = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (patch.name !== undefined) set('display_name', next.name);
    if (patch.hostname !== undefined) set('hostname', next.hostname);
    if (patch.role !== undefined) set('role_code', next.role);
    if (patch.model !== undefined) set('model_id', await modelId(c, next.model));
    if (place) {
      set('location_id', place.locationId);
      set('floor_id', place.floorId);
    }
    if (patch.ip !== undefined) set('mgmt_ip', next.ip);
    if (patch.mac !== undefined) set('mac', next.mac);
    if (patch.lifecycle !== undefined) set('lifecycle', next.lifecycle);
    if (patch.dataStatus !== undefined) {
      set('data_status', next.dataStatus);
      if (next.dataStatus === 'verified' && cur.dataStatus !== 'verified')
        sets.push('verified_at = now()');
    }
    if (sets.length) {
      try {
        await c.query(`UPDATE net.devices SET ${sets.join(', ')} WHERE id = $1`, vals);
      } catch (err) {
        if ((err as { code?: string }).code === '23514')
          throw invalid('floor', 'ต้องเลือกห้อง หรืออาคาร + ชั้น');
        throw err;
      }
    }
    if (patch.uplink !== undefined || patch.uplinkMedia !== undefined) {
      await setUplink(c, row.id, code, next.uplink, patch.uplinkMedia ?? null);
    }
    return (await getDeviceEdit(c, code)) as DeviceEdit;
  });
}

export async function createDevice(
  pool: pg.Pool,
  input: DeviceCreate,
  actor: string,
): Promise<DeviceEdit> {
  return inTx(pool, actor, async (c) => {
    const taken = await c.query('SELECT 1 FROM net.devices WHERE code = $1', [input.code]);
    if (taken.rowCount)
      throw invalid('code', `รหัส ${input.code} ถูกใช้แล้ว (รหัสไม่นำกลับมาใช้ซ้ำ)`);
    await checkRole(c, input.role);
    await checkIp(c, input.ip, null);
    const place = await resolvePlace(c, input.locCode ? { locCode: input.locCode } : input);
    if (!place.locationId && !place.floorId && !['wan', 'controller'].includes(input.role)) {
      throw invalid('floor', 'ต้องเลือกห้อง หรืออาคาร + ชั้น');
    }
    const ins = await c.query<{ id: string }>(
      `INSERT INTO net.devices (code, display_name, hostname, role_code, model_id, location_id, floor_id, mgmt_ip, mac,
         lifecycle, data_status, verified_at, attributes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $11 = 'verified' THEN now() END, $12)
       RETURNING id`,
      [
        input.code,
        input.name,
        input.hostname,
        input.role,
        await modelId(c, input.model),
        place.locationId,
        place.floorId,
        input.ip,
        input.mac,
        input.lifecycle,
        input.dataStatus,
        { source: 'registry_editor' },
      ],
    );
    const id = ins.rows[0]?.id as string;
    if (input.uplink) await setUplink(c, id, input.code, input.uplink, input.uplinkMedia);
    return (await getDeviceEdit(c, input.code)) as DeviceEdit;
  });
}

/** Soft delete; the code stays reserved (ADR-0002). Devices below lose their uplink. */
export async function deleteDevice(
  pool: pg.Pool,
  code: string,
  rowVersion: number,
  actor: string,
): Promise<void> {
  await inTx(pool, actor, async (c) => {
    const r = await c.query<{ id: string; row_version: number }>(
      'SELECT id, row_version FROM net.devices WHERE code = $1 AND deleted_at IS NULL FOR UPDATE',
      [code],
    );
    const row = r.rows[0];
    if (!row) throw new RegistryEditError('not_found', `ไม่พบอุปกรณ์ ${code}`);
    if (row.row_version !== rowVersion) {
      throw new RegistryEditError(
        'conflict',
        'มีคนแก้อุปกรณ์นี้ไปก่อนแล้ว — โหลดข้อมูลใหม่แล้วลองอีกครั้ง',
      );
    }
    await c.query(
      'UPDATE net.links SET deleted_at = now() WHERE (a_device_id = $1 OR b_device_id = $1) AND deleted_at IS NULL',
      [row.id],
    );
    await c.query('UPDATE net.devices SET deleted_at = now() WHERE id = $1', [row.id]);
  });
}

// ---------- locations ----------

const LOCATION_EDIT_SQL = `
  SELECT l.id, l.loc_code, b.code AS building, f.level::int AS floor, l.name, l.room_number, l.type_code,
         l.corridor_order::int, l.side, l.has_rack, l.owner_system, l.row_version
  FROM core.locations l JOIN core.floors f ON f.id = l.floor_id JOIN core.buildings b ON b.id = f.building_id
  WHERE l.loc_code = $1 AND l.deleted_at IS NULL`;

interface LocationRow {
  id: string;
  loc_code: string;
  building: string;
  floor: number;
  name: string;
  room_number: string | null;
  type_code: string | null;
  corridor_order: number | null;
  side: LocationEdit['side'];
  has_rack: boolean;
  owner_system: string;
  row_version: number;
}

const toLocationEdit = (r: LocationRow): LocationEdit => ({
  locCode: r.loc_code,
  building: r.building,
  floor: r.floor,
  name: r.name,
  roomNumber: r.room_number,
  type: r.type_code,
  corridorOrder: r.corridor_order,
  side: r.side,
  hasRack: r.has_rack,
  owner: r.owner_system,
  rowVersion: r.row_version,
});

export async function getLocationEdit(
  db: pg.Pool | Client,
  locCode: string,
): Promise<LocationEdit | null> {
  const { rows } = await db.query<LocationRow>(LOCATION_EDIT_SQL, [locCode]);
  return rows[0] ? toLocationEdit(rows[0]) : null;
}

async function checkType(c: Client, type: string | null): Promise<void> {
  if (!type) return;
  const r = await c.query('SELECT 1 FROM core.location_types WHERE code = $1', [type]);
  if (!r.rowCount) throw invalid('type', `ไม่มีประเภทพื้นที่ ${type}`);
}

export async function updateLocation(
  pool: pg.Pool,
  locCode: string,
  patch: LocationPatch,
  actor: string,
): Promise<LocationEdit> {
  return inTx(pool, actor, async (c) => {
    const { rows } = await c.query<LocationRow>(`${LOCATION_EDIT_SQL} FOR UPDATE OF l`, [locCode]);
    const row = rows[0];
    if (!row) throw new RegistryEditError('not_found', `ไม่พบห้อง ${locCode}`);
    if (row.row_version !== patch.rowVersion) {
      throw new RegistryEditError(
        'conflict',
        'มีคนแก้ห้องนี้ไปก่อนแล้ว — โหลดข้อมูลใหม่แล้วแก้อีกครั้ง',
      );
    }
    const next = {
      ...toLocationEdit(row),
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    };
    const sets: string[] = [];
    const vals: unknown[] = [row.id];
    const set = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (patch.building !== undefined || patch.floor !== undefined) {
      const p = await resolvePlace(c, { building: next.building, floor: next.floor });
      set('floor_id', p.floorId);
    }
    if (patch.name !== undefined) set('name', next.name);
    if (patch.roomNumber !== undefined) set('room_number', next.roomNumber);
    if (patch.type !== undefined) {
      await checkType(c, next.type);
      set('type_code', next.type);
    }
    if (patch.corridorOrder !== undefined) set('corridor_order', next.corridorOrder);
    if (patch.side !== undefined) set('side', next.side);
    if (patch.hasRack !== undefined) set('has_rack', next.hasRack);
    if (sets.length)
      await c.query(`UPDATE core.locations SET ${sets.join(', ')} WHERE id = $1`, vals);
    return (await getLocationEdit(c, locCode)) as LocationEdit;
  });
}

export async function createLocation(
  pool: pg.Pool,
  input: LocationCreate,
  actor: string,
): Promise<LocationEdit> {
  return inTx(pool, actor, async (c) => {
    const p = await resolvePlace(c, { building: input.building, floor: input.floor });
    await checkType(c, input.type);
    const ins = await c.query<{ loc_code: string }>(
      `INSERT INTO core.locations (loc_code, floor_id, name, room_number, type_code, corridor_order, side, has_rack,
         owner_system, attributes)
       VALUES (core.next_loc_code(), $1, $2, $3, $4, $5, $6, $7, 'noc', $8) RETURNING loc_code`,
      [
        p.floorId,
        input.name,
        input.roomNumber,
        input.type,
        input.corridorOrder,
        input.side,
        input.hasRack,
        { source: 'registry_editor' },
      ],
    );
    return (await getLocationEdit(c, ins.rows[0]?.loc_code as string)) as LocationEdit;
  });
}

// ---------- unplaced APs (ADR-0020) ----------

export async function listUnplacedAps(db: pg.Pool | Client): Promise<UnplacedAp[]> {
  const { rows } = await db.query<{ system: string; mac: string; message: string; since: Date }>(
    `SELECT DISTINCT ON (system_code, external_id) system_code AS system, external_id AS mac, message,
            created_at AS since
     FROM sync.issues WHERE kind = 'unplaced_ap' AND resolved_at IS NULL
     ORDER BY system_code, external_id, created_at DESC`,
  );
  // Name/IP are in the message the import wrote: AP "<name>" (<mac>, <ip>): …
  return rows.map((r) => {
    const m = /^AP "(.*)" \([^,]+, ([^)]+)\)/.exec(r.message);
    const ip = m?.[2] && m[2] !== 'ไม่มี IP' ? m[2] : null;
    return {
      system: r.system,
      mac: r.mac,
      name: m?.[1] ?? r.mac,
      ip,
      message: r.message,
      since: r.since.toISOString(),
    };
  });
}

/**
 * Registers an unplaced AP on the chosen room/floor. The controller import then finds it by MAC,
 * keeps the position (it never moves rows people placed) and only refreshes name, IP and firmware.
 */
export async function placeUnplacedAp(
  pool: pg.Pool,
  system: string,
  mac: string,
  where: PlaceAp,
  actor: string,
): Promise<DeviceEdit> {
  return inTx(pool, actor, async (c) => {
    const ap = (await listUnplacedAps(c)).find((a) => a.system === system && a.mac === mac);
    if (!ap) throw new RegistryEditError('not_found', `ไม่มี AP ${mac} ในรายการรอตำแหน่ง`);
    const p = await resolvePlace(c, where.locCode ? { locCode: where.locCode } : where);
    if (!p.locationId && !p.floorId) throw invalid('floor', 'ต้องเลือกห้อง หรืออาคาร + ชั้น');
    const at = await c.query<{ building: string; level: number }>(
      `SELECT b.code AS building, f.level::int AS level FROM core.floors f JOIN core.buildings b ON b.id = f.building_id
       WHERE f.id = coalesce($1::uuid, (SELECT floor_id FROM core.locations WHERE id = $2::uuid))`,
      [p.floorId, p.locationId],
    );
    const { building, level } = at.rows[0] as { building: string; level: number };
    const prefix = `ap-${building}-${level}-`;
    let no = where.no;
    if (no === null) {
      const used = await c.query<{ code: string }>(
        `SELECT code FROM net.devices WHERE code LIKE $1`,
        [`${prefix}%`],
      );
      const nums = new Set(
        used.rows.map((r) => Number(r.code.slice(prefix.length))).filter(Number.isInteger),
      );
      no = 1;
      while (nums.has(no)) no += 1;
    }
    const code = `${prefix}${no}`;
    const taken = await c.query('SELECT 1 FROM net.devices WHERE code = $1', [code]);
    if (taken.rowCount) throw invalid('no', `รหัส ${code} ถูกใช้แล้ว`);
    // Same controller as the system's other APs (ctl-unifi / ctl-omada).
    const controller = await c.query<{ id: string }>(
      `SELECT d.managed_by_device_id AS id FROM net.devices d JOIN core.external_refs x ON x.entity_id = d.id
       WHERE x.system_code = $1 AND x.entity_table = 'net.devices' AND d.managed_by_device_id IS NOT NULL LIMIT 1`,
      [system],
    );
    // An IP already used by another device is left empty (the import reports ip_conflict).
    const ipFree = ap.ip
      ? !(
          await c.query(
            'SELECT 1 FROM net.devices WHERE mgmt_ip = $1::inet AND deleted_at IS NULL',
            [ap.ip],
          )
        ).rowCount
      : false;
    const ins = await c.query<{ id: string }>(
      `INSERT INTO net.devices (code, display_name, hostname, role_code, location_id, floor_id, managed_by_device_id,
         poe_powered, mgmt_ip, mac, attributes)
       VALUES ($1, $2, $3, 'ap', $4, $5, $6, true, $7, $8, $9) RETURNING id`,
      [
        code,
        `AP ${ap.name}`,
        ap.name,
        p.locationId,
        p.floorId,
        controller.rows[0]?.id ?? null,
        ipFree ? ap.ip : null,
        mac,
        { source: system, floor_from: 'registry_editor' },
      ],
    );
    await c.query(
      `INSERT INTO core.external_refs (entity_table, entity_id, system_code, external_id, external_key, last_seen_at)
       VALUES ('net.devices', $1, $2, $3, $4, now())`,
      [ins.rows[0]?.id, system, mac, ap.name],
    );
    await c.query(
      `UPDATE sync.issues SET resolved_at = now() WHERE system_code = $1 AND kind = 'unplaced_ap'
         AND external_id = $2 AND resolved_at IS NULL`,
      [system, mac],
    );
    return (await getDeviceEdit(c, code)) as DeviceEdit;
  });
}

// ---------- history ----------

const HIDDEN = new Set(['updated_at', 'row_version', 'created_at']);

export async function getHistory(
  db: pg.Pool,
  kind: 'device' | 'location',
  code: string,
  limit = 30,
): Promise<HistoryEntry[]> {
  const table = kind === 'device' ? 'net.devices' : 'core.locations';
  const id = await db.query<{ id: string }>(
    kind === 'device'
      ? 'SELECT id FROM net.devices WHERE code = $1'
      : 'SELECT id FROM core.locations WHERE loc_code = $1',
    [code],
  );
  const rowId = id.rows[0]?.id;
  if (!rowId) return [];
  const { rows } = await db.query<{
    at: Date;
    actor: string;
    op: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }>(
    `SELECT at, actor, op, before, after FROM audit.change_log WHERE table_name = $1 AND row_id = $2
     ORDER BY at DESC, id DESC LIMIT $3`,
    [table, rowId, limit],
  );
  return rows.map((r) => {
    const keys = new Set([...Object.keys(r.before ?? {}), ...Object.keys(r.after ?? {})]);
    const changes = [...keys]
      .filter((k) => !HIDDEN.has(k))
      .filter((k) => JSON.stringify(r.before?.[k]) !== JSON.stringify(r.after?.[k]))
      .map((k) => ({ field: k, before: r.before?.[k] ?? null, after: r.after?.[k] ?? null }));
    return { at: r.at.toISOString(), actor: r.actor, op: r.op, changes };
  });
}
