// M14: read-only queries behind the registry/layout API. Shapes follow @sbc-noc/shared registry.ts.
// Soft-deleted rows are never returned; sample rows (data_status = 'sample') neither.
import type {
  Area,
  Building,
  BuildingDetail,
  Cable,
  Device,
  DeviceDetail,
  Layout,
  Link,
  Location,
  SearchHit,
} from '@sbc-noc/shared';
import type pg from 'pg';

type Q = Pick<pg.Pool, 'query'>;

const iso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : String(v);

// ---------- buildings ----------

const BUILDING_SQL = `
  SELECT b.code, b.name, b.name_en, b.aliases, b.asset_name, b.form_code, b.floor_count::int,
         b.rooms_per_floor::int, b.has_network,
         s.x::float8 AS x, s.z::float8 AS z, s.width::float8 AS width, s.depth::float8 AS depth,
         s.rotation::float8 AS rotation, s.floor_height::float8 AS floor_height, s.shape
  FROM core.buildings b LEFT JOIN viz.building_shapes s ON s.building_id = b.id
  WHERE b.deleted_at IS NULL`;

interface BuildingRow {
  code: string;
  name: string;
  name_en: string | null;
  aliases: string[];
  asset_name: string | null;
  form_code: string | null;
  floor_count: number;
  rooms_per_floor: number | null;
  has_network: boolean;
  x: number | null;
  z: number;
  width: number;
  depth: number;
  rotation: number;
  floor_height: number;
  shape: Record<string, unknown>;
}

function toBuilding(r: BuildingRow): Building {
  return {
    code: r.code,
    name: r.name,
    nameEn: r.name_en,
    aliases: r.aliases,
    assetName: r.asset_name,
    form: r.form_code,
    floorCount: r.floor_count,
    roomsPerFloor: r.rooms_per_floor,
    hasNetwork: r.has_network,
    shape:
      r.x === null
        ? null
        : {
            x: r.x,
            z: r.z,
            width: r.width,
            depth: r.depth,
            rotation: r.rotation,
            floorHeight: r.floor_height,
            extra: r.shape,
          },
  };
}

export async function listBuildings(db: Q): Promise<Building[]> {
  const { rows } = await db.query<BuildingRow>(`${BUILDING_SQL} ORDER BY b.code`);
  return rows.map(toBuilding);
}

export async function getBuilding(db: Q, code: string): Promise<BuildingDetail | null> {
  const { rows } = await db.query<BuildingRow>(`${BUILDING_SQL} AND b.code = $1`, [code]);
  const row = rows[0];
  if (!row) return null;
  const floors = await db.query<{
    level: number;
    name: string | null;
    locations: number;
    devices: number;
  }>(
    `SELECT f.level::int, f.name,
            (SELECT count(*)::int FROM core.locations l WHERE l.floor_id = f.id AND l.deleted_at IS NULL) AS locations,
            (SELECT count(*)::int FROM net.devices d
               LEFT JOIN core.locations l ON l.id = d.location_id
             WHERE coalesce(d.floor_id, l.floor_id) = f.id AND d.deleted_at IS NULL
               AND d.data_status <> 'sample') AS devices
     FROM core.floors f JOIN core.buildings b ON b.id = f.building_id
     WHERE b.code = $1 ORDER BY f.level`,
    [code],
  );
  return { ...toBuilding(row), floors: floors.rows };
}

// ---------- areas ----------

export async function listAreas(db: Q): Promise<Area[]> {
  const { rows } = await db.query<Area>(
    `SELECT code, name, kind, x::float8 AS x, z::float8 AS z, width::float8 AS width,
            depth::float8 AS depth, rotation::float8 AS rotation
     FROM viz.area_shapes ORDER BY code`,
  );
  return rows;
}

// ---------- locations ----------

export interface LocationFilter {
  building?: string | undefined;
  floor?: number | undefined;
}

export async function listLocations(db: Q, f: LocationFilter = {}): Promise<Location[]> {
  const { rows } = await db.query<{
    loc_code: string;
    building: string;
    floor: number;
    name: string;
    room_number: string | null;
    type_code: string | null;
    corridor_order: number | null;
    side: string | null;
    has_rack: boolean;
    owner_system: string;
    verified_at: Date | null;
    pcs: number | null;
  }>(
    `SELECT l.loc_code, b.code AS building, f.level::int AS floor, l.name, l.room_number, l.type_code,
            l.corridor_order::int, l.side, l.has_rack, l.owner_system, l.verified_at,
            (SELECT m.value::int FROM core.location_metrics m
             WHERE m.location_id = l.id AND m.metric = 'registry_pc_count' AND m.source = 'sbc_asset') AS pcs
     FROM core.locations l JOIN core.floors f ON f.id = l.floor_id JOIN core.buildings b ON b.id = f.building_id
     WHERE l.deleted_at IS NULL AND ($1::text IS NULL OR b.code = $1) AND ($2::int IS NULL OR f.level = $2)
     ORDER BY b.code, f.level, l.corridor_order NULLS LAST, l.loc_code`,
    [f.building ?? null, f.floor ?? null],
  );
  return rows.map((r) => ({
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
    verifiedAt: iso(r.verified_at),
    registryPcCount: r.pcs,
  }));
}

export async function getLocation(db: Q, locCode: string): Promise<Location | null> {
  const all = await db.query<{ building: string; floor: number }>(
    `SELECT b.code AS building, f.level::int AS floor FROM core.locations l
     JOIN core.floors f ON f.id = l.floor_id JOIN core.buildings b ON b.id = f.building_id
     WHERE l.loc_code = $1 AND l.deleted_at IS NULL`,
    [locCode],
  );
  const at = all.rows[0];
  if (!at) return null;
  return (await listLocations(db, at)).find((l) => l.locCode === locCode) ?? null;
}

// ---------- devices ----------

export interface DeviceFilter {
  building?: string | undefined;
  floor?: number | undefined;
  role?: string | undefined;
  layer?: string | undefined;
  code?: string | undefined;
}

const DEVICE_SQL = `
  SELECT d.id, d.code, d.display_name, d.hostname, d.role_code, r.layer, m.name AS model,
         host(d.mgmt_ip) AS ip, d.mac::text AS mac, b.code AS building, coalesce(f.level, lf.level)::int AS floor,
         l.loc_code, up.code AS uplink, lk.media_code AS uplink_media, mg.code AS managed_by, d.lifecycle,
         d.data_status, zx.external_id AS zabbix_hostid,
         p.mode AS p_mode, p.u::float8 AS p_u, p.v::float8 AS p_v, p.height_offset::float8 AS p_h,
         d.firmware_version, rk.code AS rack, ps.code AS power_source, a.asset_tag,
         to_char(a.warranty_until, 'YYYY-MM-DD') AS warranty_until,
         to_char(m.eol_date, 'YYYY-MM-DD') AS eol_date, d.verified_at
  FROM net.devices d
  JOIN catalog.device_roles r ON r.code = d.role_code
  LEFT JOIN catalog.models m ON m.id = d.model_id
  LEFT JOIN core.locations l ON l.id = d.location_id
  LEFT JOIN core.floors lf ON lf.id = l.floor_id
  LEFT JOIN core.floors f ON f.id = d.floor_id
  LEFT JOIN core.buildings b ON b.id = coalesce(f.building_id, lf.building_id)
  LEFT JOIN net.links lk ON lk.b_device_id = d.id AND lk.is_uplink AND lk.deleted_at IS NULL
  LEFT JOIN net.devices up ON up.id = lk.a_device_id
  LEFT JOIN net.devices mg ON mg.id = d.managed_by_device_id
  LEFT JOIN net.devices ps ON ps.id = d.power_source_device_id
  LEFT JOIN net.racks rk ON rk.id = d.rack_id
  LEFT JOIN asset.assets a ON a.id = d.asset_id
  LEFT JOIN viz.device_placements p ON p.device_id = d.id
  LEFT JOIN core.external_refs zx ON zx.entity_table = 'net.devices' AND zx.entity_id = d.id
                                  AND zx.system_code = 'zabbix'
  WHERE d.deleted_at IS NULL AND d.data_status <> 'sample'
    AND ($1::text IS NULL OR b.code = $1) AND ($2::int IS NULL OR coalesce(f.level, lf.level) = $2)
    AND ($3::text IS NULL OR d.role_code = $3) AND ($4::text IS NULL OR r.layer = $4)
    AND ($5::text IS NULL OR d.code = $5)
  ORDER BY b.code NULLS FIRST, coalesce(f.level, lf.level) NULLS FIRST, d.code`;

interface DeviceRow {
  id: string;
  code: string;
  display_name: string;
  hostname: string | null;
  role_code: string;
  layer: string;
  model: string | null;
  ip: string | null;
  mac: string | null;
  building: string | null;
  floor: number | null;
  loc_code: string | null;
  uplink: string | null;
  uplink_media: string | null;
  managed_by: string | null;
  lifecycle: string;
  data_status: string;
  zabbix_hostid: string | null;
  p_mode: string | null;
  p_u: number | null;
  p_v: number | null;
  p_h: number | null;
  firmware_version: string | null;
  rack: string | null;
  power_source: string | null;
  asset_tag: string | null;
  warranty_until: string | null;
  eol_date: string | null;
  verified_at: Date | null;
}

function toDevice(r: DeviceRow): Device {
  return {
    code: r.code,
    name: r.display_name,
    hostname: r.hostname,
    role: r.role_code,
    layer: r.layer,
    model: r.model,
    ip: r.ip,
    mac: r.mac,
    building: r.building,
    floor: r.floor,
    locCode: r.loc_code,
    uplink: r.uplink,
    uplinkMedia: r.uplink_media,
    managedBy: r.managed_by,
    lifecycle: r.lifecycle,
    dataStatus: r.data_status,
    zabbixHostId: r.zabbix_hostid,
    placement:
      r.p_mode === null ? null : { mode: r.p_mode, u: r.p_u, v: r.p_v, heightOffset: r.p_h ?? 0 },
  };
}

const deviceParams = (f: DeviceFilter) => [
  f.building ?? null,
  f.floor ?? null,
  f.role ?? null,
  f.layer ?? null,
  f.code ?? null,
];

export async function listDevices(db: Q, f: DeviceFilter = {}): Promise<Device[]> {
  const { rows } = await db.query<DeviceRow>(DEVICE_SQL, deviceParams(f));
  return rows.map(toDevice);
}

export async function getDevice(db: Q, code: string): Promise<DeviceDetail | null> {
  const { rows } = await db.query<DeviceRow>(DEVICE_SQL, deviceParams({ code }));
  const r = rows[0];
  if (!r) return null;
  const down = await db.query<{ code: string; name: string; layer: string }>(
    `SELECT d.code, d.display_name AS name, r.layer FROM net.links k
     JOIN net.devices d ON d.id = k.b_device_id JOIN catalog.device_roles r ON r.code = d.role_code
     WHERE k.a_device_id = $1 AND k.is_uplink AND k.deleted_at IS NULL AND d.deleted_at IS NULL
       AND d.data_status <> 'sample'
     ORDER BY d.code`,
    [r.id],
  );
  const refs = await db.query<{
    system: string;
    id: string;
    key: string | null;
    last_seen_at: Date | null;
  }>(
    `SELECT system_code AS system, external_id AS id, external_key AS key, last_seen_at
     FROM core.external_refs WHERE entity_table = 'net.devices' AND entity_id = $1 ORDER BY system_code`,
    [r.id],
  );
  return {
    ...toDevice(r),
    firmware: r.firmware_version,
    rack: r.rack,
    powerSource: r.power_source,
    assetTag: r.asset_tag,
    warrantyUntil: r.warranty_until,
    eolDate: r.eol_date,
    verifiedAt: iso(r.verified_at),
    downlinks: down.rows,
    externalRefs: refs.rows.map((x) => ({
      system: x.system,
      id: x.id,
      key: x.key,
      lastSeenAt: iso(x.last_seen_at),
    })),
  };
}

// ---------- links, cables ----------

export async function listLinks(db: Q): Promise<Link[]> {
  const { rows } = await db.query<{
    code: string | null;
    a: string;
    b: string;
    media_code: string;
    is_uplink: boolean;
    cable: string | null;
    cable_cores: number[] | null;
    speed_mbps: number | null;
    color: string | null;
    lane: number | null;
    waypoints: unknown;
  }>(
    `SELECT k.code, da.code AS a, db.code AS b, k.media_code, k.is_uplink, c.code AS cable, k.cable_cores,
            k.speed_mbps, rt.color, rt.lane, rt.waypoints
     FROM net.links k JOIN net.devices da ON da.id = k.a_device_id JOIN net.devices db ON db.id = k.b_device_id
     LEFT JOIN net.cables c ON c.id = k.cable_id LEFT JOIN viz.link_routes rt ON rt.link_id = k.id
     WHERE k.deleted_at IS NULL AND da.deleted_at IS NULL AND db.deleted_at IS NULL
       AND da.data_status <> 'sample' AND db.data_status <> 'sample'
     ORDER BY da.code, db.code`,
  );
  return rows.map((r) => ({
    code: r.code,
    a: r.a,
    b: r.b,
    media: r.media_code,
    isUplink: r.is_uplink,
    cable: r.cable,
    cableCores: r.cable_cores,
    speedMbps: r.speed_mbps,
    color: r.color,
    lane: r.lane,
    waypoints: toWaypoints(r.waypoints),
  }));
}

/** viz.link_routes.waypoints is free jsonb: keep [x, z] pairs or {x, z} objects, drop the rest. */
export function toWaypoints(v: unknown): [number, number][] {
  if (!Array.isArray(v)) return [];
  const out: [number, number][] = [];
  for (const p of v as unknown[]) {
    const [x, z] = Array.isArray(p) ? p : [(p as { x?: unknown })?.x, (p as { z?: unknown })?.z];
    if (typeof x === 'number' && typeof z === 'number' && isFinite(x) && isFinite(z))
      out.push([x, z]);
  }
  return out;
}

export async function listCables(db: Q): Promise<Cable[]> {
  const { rows } = await db.query<{
    code: string;
    kind: string;
    core_count: number | null;
    length_m: number | null;
    a_loc: string | null;
    b_loc: string | null;
    route_note: string | null;
    status: string;
  }>(
    `SELECT c.code, c.kind, c.core_count::int, c.length_m, la.loc_code AS a_loc, lb.loc_code AS b_loc,
            c.route_note, c.status
     FROM net.cables c LEFT JOIN core.locations la ON la.id = c.a_location_id
     LEFT JOIN core.locations lb ON lb.id = c.b_location_id
     WHERE c.deleted_at IS NULL ORDER BY c.code`,
  );
  return rows.map((r) => ({
    code: r.code,
    kind: r.kind,
    coreCount: r.core_count,
    lengthM: r.length_m,
    aLocCode: r.a_loc,
    bLocCode: r.b_loc,
    route: r.route_note,
    status: r.status,
  }));
}

// ---------- layout ----------

export async function getLayout(db: Q): Promise<Layout> {
  const site = await db.query<{ code: string; name: string; timezone: string }>(
    `SELECT code, name, timezone FROM core.sites WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`,
  );
  const [buildings, areas, locations, devices, links, cables] = await Promise.all([
    listBuildings(db),
    listAreas(db),
    listLocations(db),
    listDevices(db),
    listLinks(db),
    listCables(db),
  ]);
  return {
    site: site.rows[0] ?? { code: '', name: '', timezone: 'Asia/Bangkok' },
    buildings,
    areas,
    locations,
    devices,
    links,
    cables,
  };
}

// ---------- search ----------

/**
 * Search buildings (name, code, aliases), rooms (LOC, name, room number) and devices
 * (code, name, hostname, IP, MAC). Case-insensitive substring; exact codes first.
 */
export async function search(db: Q, q: string, limit = 20): Promise<SearchHit[]> {
  const term = q.trim();
  if (!term) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { rows } = await db.query<{
    kind: SearchHit['kind'];
    code: string;
    label: string;
    building: string | null;
    floor: number | null;
    match: string;
    exact: boolean;
  }>(
    `SELECT * FROM (
       SELECT 'building' AS kind, b.code, b.name AS label, b.code AS building, NULL::int AS floor,
              CASE WHEN b.name ILIKE $1 THEN b.name ELSE 'ชื่อเรียก ' || array_to_string(b.aliases, ', ') END AS match,
              lower(b.code) = lower($2) AS exact
       FROM core.buildings b
       WHERE b.deleted_at IS NULL AND (b.name ILIKE $1 OR b.code ILIKE $1 OR b.name_en ILIKE $1
             OR EXISTS (SELECT 1 FROM unnest(b.aliases) a WHERE a ILIKE $1))
       UNION ALL
       SELECT 'location', l.loc_code, l.name, b.code, f.level::int,
              CASE WHEN l.loc_code ILIKE $1 THEN l.loc_code WHEN l.room_number ILIKE $1 THEN 'ห้อง ' || l.room_number
                   ELSE l.name END,
              lower(l.loc_code) = lower($2) OR lower(coalesce(l.room_number, '')) = lower($2)
       FROM core.locations l JOIN core.floors f ON f.id = l.floor_id JOIN core.buildings b ON b.id = f.building_id
       WHERE l.deleted_at IS NULL AND (l.loc_code ILIKE $1 OR l.name ILIKE $1 OR l.room_number ILIKE $1)
       UNION ALL
       SELECT 'device', d.code, d.display_name, b.code, coalesce(f.level, lf.level)::int,
              CASE WHEN host(d.mgmt_ip) ILIKE $1 THEN 'IP ' || host(d.mgmt_ip)
                   WHEN d.mac::text ILIKE $1 THEN 'MAC ' || d.mac::text
                   WHEN d.code ILIKE $1 THEN d.code WHEN d.hostname ILIKE $1 THEN d.hostname
                   ELSE d.display_name END,
              lower(d.code) = lower($2) OR coalesce(host(d.mgmt_ip) = $2, false)
       FROM net.devices d
       LEFT JOIN core.locations l ON l.id = d.location_id LEFT JOIN core.floors lf ON lf.id = l.floor_id
       LEFT JOIN core.floors f ON f.id = d.floor_id
       LEFT JOIN core.buildings b ON b.id = coalesce(f.building_id, lf.building_id)
       WHERE d.deleted_at IS NULL AND d.data_status <> 'sample'
         AND (d.code ILIKE $1 OR d.display_name ILIKE $1 OR d.hostname ILIKE $1
              OR host(d.mgmt_ip) ILIKE $1 OR d.mac::text ILIKE $1)
     ) hits
     ORDER BY exact DESC NULLS LAST, CASE kind WHEN 'building' THEN 0 WHEN 'location' THEN 1 ELSE 2 END, code
     LIMIT $3`,
    [like, term, limit],
  );
  return rows.map((h) => ({
    kind: h.kind,
    code: h.code,
    label: h.label,
    building: h.building,
    floor: h.floor,
    match: h.match,
  }));
}
