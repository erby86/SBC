// M04: imports the one-time seed (infra/seed) into schema v1.1. Idempotent: every write is an
// upsert keyed on a natural code and only touches rows whose values changed, so a second run
// with the same files writes nothing (no row_version bump, no audit entries).
import type pg from 'pg';
import type { SeedFiles } from './files.js';
import { applyPrototypeRoutes } from './routes.js';
import {
  buildingForm,
  deviceStatus,
  fiberCode,
  locationType,
  mediaCode,
  modelOf,
  orNull,
  parseVlans,
  toInt,
} from './map.js';

type Client = pg.PoolClient;

const SITE = { code: 'sbc', name: 'SB School' };
const ACTOR = 'seed:M04';
const LOC_PATTERN = /^LOC-\d{3,}$/;

export interface SeedReport {
  expected: Record<string, number>;
  actual: Record<string, number>;
  written: number;
}

/** Runs `sql`; returns the id from RETURNING or, when the upsert was a no-op, from `lookup`. */
async function upsert(
  c: Client,
  sql: string,
  params: unknown[],
  lookup: string,
  lookupParams: unknown[],
  counter: { n: number },
): Promise<string> {
  const res = await c.query<{ id: string }>(sql, params);
  if (res.rows[0]) {
    counter.n += 1;
    return String(res.rows[0].id);
  }
  const found = await c.query<{ id: string }>(lookup, lookupParams);
  if (!found.rows[0])
    throw new Error(`upsert found no row: ${lookup} ${JSON.stringify(lookupParams)}`);
  return String(found.rows[0].id);
}

export async function importSeed(pool: pg.Pool, seed: SeedFiles): Promise<SeedReport> {
  const c = await pool.connect();
  const written = { n: 0 };
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.actor', $1, true)`, [ACTOR]);

    // ---- site, staff ----
    const siteId = await upsert(
      c,
      `INSERT INTO core.sites (code, name) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       WHERE core.sites.name IS DISTINCT FROM EXCLUDED.name RETURNING id`,
      [SITE.code, SITE.name],
      'SELECT id FROM core.sites WHERE code = $1',
      [SITE.code],
      written,
    );
    for (const code of seed.layout.staff) {
      await upsert(
        c,
        `INSERT INTO core.staff (staff_code, full_name) VALUES ($1, $1)
         ON CONFLICT (staff_code) DO NOTHING RETURNING id`,
        [code],
        'SELECT id FROM core.staff WHERE staff_code = $1',
        [code],
        written,
      );
    }

    // ---- buildings, floors, 3D shapes ----
    const shapes = new Map(seed.layout.buildings.map((b) => [b.code, b]));
    const buildingIds = new Map<string, string>();
    const floorIds = new Map<string, string>(); // "b2:1"
    for (const row of seed.buildings) {
      const code = row['รหัสอาคาร'] ?? '';
      const floors = toInt(row['จำนวนชั้น'] ?? '') ?? 0;
      const shape = shapes.get(code);
      const attributes = { note: orNull(row['หมายเหตุ'] ?? ''), source: 'gsheet_seed' };
      const id = await upsert(
        c,
        `INSERT INTO core.buildings (site_id, code, name, asset_name, form_code, floor_count, rooms_per_floor, attributes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (site_id, code) DO UPDATE SET
           name = EXCLUDED.name, asset_name = EXCLUDED.asset_name, form_code = EXCLUDED.form_code,
           floor_count = EXCLUDED.floor_count, rooms_per_floor = EXCLUDED.rooms_per_floor, attributes = EXCLUDED.attributes
         WHERE (core.buildings.name, core.buildings.asset_name, core.buildings.form_code, core.buildings.floor_count,
                core.buildings.rooms_per_floor, core.buildings.attributes)
           IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.asset_name, EXCLUDED.form_code, EXCLUDED.floor_count,
                EXCLUDED.rooms_per_floor, EXCLUDED.attributes)
         RETURNING id`,
        [
          siteId,
          code,
          row['อาคาร'],
          orNull(row['ชื่อใน SBC ASSET'] ?? ''),
          buildingForm(row['แบบอาคาร'] ?? ''),
          floors,
          toInt(row['ห้องต่อชั้น (ประมาณ)'] ?? ''),
          attributes,
        ],
        'SELECT id FROM core.buildings WHERE site_id = $1 AND code = $2',
        [siteId, code],
        written,
      );
      buildingIds.set(code, id);
      for (let level = 1; level <= floors; level++) {
        const floorId = await upsert(
          c,
          `INSERT INTO core.floors (building_id, level, name) VALUES ($1, $2, $3)
           ON CONFLICT (building_id, level) DO UPDATE SET name = EXCLUDED.name
           WHERE core.floors.name IS DISTINCT FROM EXCLUDED.name RETURNING id`,
          [id, level, `ชั้น ${level}`],
          'SELECT id FROM core.floors WHERE building_id = $1 AND level = $2',
          [id, level],
          written,
        );
        floorIds.set(`${code}:${level}`, floorId);
      }
      if (shape) {
        const res = await c.query(
          `INSERT INTO viz.building_shapes (building_id, x, z, width, depth, rotation, shape)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (building_id) DO UPDATE SET x = EXCLUDED.x, z = EXCLUDED.z, width = EXCLUDED.width,
             depth = EXCLUDED.depth, rotation = EXCLUDED.rotation, shape = EXCLUDED.shape
           WHERE (viz.building_shapes.x, viz.building_shapes.z, viz.building_shapes.width, viz.building_shapes.depth,
                  viz.building_shapes.rotation, viz.building_shapes.shape)
             IS DISTINCT FROM (EXCLUDED.x, EXCLUDED.z, EXCLUDED.width, EXCLUDED.depth, EXCLUDED.rotation, EXCLUDED.shape)`,
          [
            id,
            shape.x,
            shape.z,
            shape.width,
            shape.depth,
            shape.rotation,
            shape.ring ? { ring: shape.ring } : {},
          ],
        );
        written.n += res.rowCount ?? 0;
      }
    }
    for (const area of seed.layout.areas) {
      const res = await c.query(
        `INSERT INTO viz.area_shapes (site_id, code, name, kind, x, z, width, depth, rotation)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (site_id, code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, x = EXCLUDED.x,
           z = EXCLUDED.z, width = EXCLUDED.width, depth = EXCLUDED.depth, rotation = EXCLUDED.rotation
         WHERE (viz.area_shapes.name, viz.area_shapes.kind, viz.area_shapes.x, viz.area_shapes.z,
                viz.area_shapes.width, viz.area_shapes.depth, viz.area_shapes.rotation)
           IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.kind, EXCLUDED.x, EXCLUDED.z, EXCLUDED.width,
                EXCLUDED.depth, EXCLUDED.rotation)`,
        [
          siteId,
          area.code,
          area.name,
          area.area,
          area.x,
          area.z,
          area.width,
          area.depth,
          area.rotation,
        ],
      );
      written.n += res.rowCount ?? 0;
    }

    // ---- locations (LOC) ----
    const locationIds = new Map<string, string>(); // code as written in the seed → id
    for (const row of seed.areas) {
      const seedCode = row['LOC'] ?? '';
      const building = row['รหัสอาคาร'] ?? '';
      const floorId = floorIds.get(`${building}:${row['ชั้น'] ?? ''}`);
      if (!floorId) throw new Error(`${seedCode}: floor ${building}/${row['ชั้น']} not found`);
      // ADR-0001: non-LOC codes (SPORT-01..04) get a new number; the old code is kept as legacy_code.
      const legacy = LOC_PATTERN.test(seedCode) ? null : seedCode;
      const fromAsset = row['ที่มา'] === 'SBC ASSET';
      const attributes = {
        source: 'gsheet_seed',
        ...(legacy ? { legacy_code: legacy } : {}),
        ...(row['หมายเหตุ'] ? { note: row['หมายเหตุ'] } : {}),
      };
      const values = [
        floorId,
        row['ห้อง / พื้นที่'],
        locationType(row['ประเภทพื้นที่'] ?? ''),
        toInt(row['ลำดับตามทางเดิน'] ?? ''),
        row['มีตู้/จุดเครือข่าย'] === 'มี',
        fromAsset ? 'sbc_asset' : 'noc',
        attributes,
      ];
      const existing = legacy
        ? await c.query<{ id: string }>(
            `SELECT id FROM core.locations WHERE attributes->>'legacy_code' = $1`,
            [legacy],
          )
        : await c.query<{ id: string }>('SELECT id FROM core.locations WHERE loc_code = $1', [
            seedCode,
          ]);
      let id = existing.rows[0]?.id;
      if (id) {
        const res = await c.query(
          `UPDATE core.locations SET floor_id = $2, name = $3, type_code = $4, corridor_order = $5, has_rack = $6,
             owner_system = $7, attributes = $8
           WHERE id = $1 AND (floor_id, name, type_code, corridor_order, has_rack, owner_system, attributes)
             IS DISTINCT FROM ($2::uuid, $3::text, $4::text, $5::smallint, $6::boolean, $7::text, $8::jsonb)`,
          [id, ...values],
        );
        written.n += res.rowCount ?? 0;
      } else {
        const res = await c.query<{ id: string }>(
          `INSERT INTO core.locations (loc_code, floor_id, name, type_code, corridor_order, has_rack, owner_system, attributes)
           VALUES (${legacy ? 'core.next_loc_code()' : '$8'}, $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          legacy ? values : [...values, seedCode],
        );
        id = String(res.rows[0]?.id);
        written.n += 1;
      }
      locationIds.set(seedCode, id);

      const count = toInt(row['เครื่องตาม Registry'] ?? '');
      if (count !== null && fromAsset) {
        const res = await c.query(
          `INSERT INTO core.location_metrics (location_id, metric, value, source)
           VALUES ($1, 'registry_pc_count', $2, 'sbc_asset')
           ON CONFLICT (location_id, metric, source) DO UPDATE SET value = EXCLUDED.value, as_of = now()
           WHERE core.location_metrics.value IS DISTINCT FROM EXCLUDED.value`,
          [id, count],
        );
        written.n += res.rowCount ?? 0;
      }
    }

    // ---- VLANs, models, ISPs ----
    const vlanIds = new Map<number, number>();
    for (const v of seed.devices.flatMap((d) => parseVlans(d['VLAN'] ?? ''))) {
      if (vlanIds.has(v.vid)) continue;
      const id = await upsert(
        c,
        `INSERT INTO net.vlans (vid, name, planned) VALUES ($1, $2, $3)
         ON CONFLICT (vid) DO UPDATE SET name = EXCLUDED.name, planned = EXCLUDED.planned
         WHERE (net.vlans.name, net.vlans.planned) IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.planned)
         RETURNING id`,
        [v.vid, v.name ?? `VLAN ${v.vid}`, v.planned],
        'SELECT id FROM net.vlans WHERE vid = $1',
        [v.vid],
        written,
      );
      vlanIds.set(v.vid, Number(id));
    }

    const modelIds = new Map<string, number>();
    for (const m of seed.devices.map((d) => modelOf(d['รุ่น'] ?? ''))) {
      if (!m || modelIds.has(m.name)) continue;
      // vendor is unknown in the seed, so (vendor_org_id, name) cannot be the conflict target.
      const found = await c.query<{ id: number }>(
        'SELECT id FROM catalog.models WHERE vendor_org_id IS NULL AND name = $1',
        [m.name],
      );
      let id = found.rows[0]?.id;
      if (id === undefined) {
        const res = await c.query<{ id: number }>(
          'INSERT INTO catalog.models (name, kind) VALUES ($1, $2) RETURNING id',
          [m.name, m.kind],
        );
        id = res.rows[0]?.id;
        written.n += 1;
      }
      modelIds.set(m.name, Number(id));
    }

    const orgIds = new Map<string, string>();
    for (const w of seed.layout.wan) {
      const code = w.provider.toLowerCase();
      const id = await upsert(
        c,
        `INSERT INTO core.organizations (code, name, kinds) VALUES ($1, $2, '{isp}')
         ON CONFLICT (code) DO NOTHING RETURNING id`,
        [code, w.provider],
        'SELECT id FROM core.organizations WHERE code = $1',
        [code],
        written,
      );
      orgIds.set(w.device, id);
    }

    // ---- devices ----
    const deviceIds = new Map<string, string>();
    const deviceBuilding = new Map<string, string>();
    for (const row of seed.devices) {
      const code = row['รหัสในภาพ 3D'] ?? '';
      const building = row['รหัสอาคาร'] ?? '';
      const floor = row['ชั้น'] ?? '';
      const loc = orNull(row['LOC'] ?? '');
      const model = modelOf(row['รุ่น'] ?? '');
      const status = deviceStatus(row['สถานะข้อมูล'] ?? '');
      const attributes = {
        source: 'gsheet_seed',
        ...(row['รุ่น'] && !model ? { model_note: row['รุ่น'] } : {}),
        ...(row['เลขครุภัณฑ์'] ? { asset_tag: row['เลขครุภัณฑ์'] } : {}),
        ...(row['หมายเหตุ'] ? { note: row['หมายเหตุ'] } : {}),
      };
      if (building) deviceBuilding.set(code, building);
      const id = await upsert(
        c,
        `INSERT INTO net.devices (code, display_name, hostname, role_code, model_id, location_id, floor_id, mgmt_ip,
           lifecycle, data_status, attributes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9, $10, $11)
         ON CONFLICT (code) DO UPDATE SET display_name = EXCLUDED.display_name, hostname = EXCLUDED.hostname,
           role_code = EXCLUDED.role_code, model_id = EXCLUDED.model_id, location_id = EXCLUDED.location_id,
           floor_id = EXCLUDED.floor_id, mgmt_ip = EXCLUDED.mgmt_ip, lifecycle = EXCLUDED.lifecycle,
           data_status = EXCLUDED.data_status, attributes = EXCLUDED.attributes
         WHERE (net.devices.display_name, net.devices.hostname, net.devices.role_code, net.devices.model_id,
                net.devices.location_id, net.devices.floor_id, net.devices.mgmt_ip, net.devices.lifecycle,
                net.devices.data_status, net.devices.attributes)
           IS DISTINCT FROM (EXCLUDED.display_name, EXCLUDED.hostname, EXCLUDED.role_code, EXCLUDED.model_id,
                EXCLUDED.location_id, EXCLUDED.floor_id, EXCLUDED.mgmt_ip, EXCLUDED.lifecycle,
                EXCLUDED.data_status, EXCLUDED.attributes)
         RETURNING id`,
        [
          code,
          row['ชื่อที่แสดง'],
          orNull(row['ชื่อ host ใน Zabbix'] ?? ''),
          row['ประเภท'],
          model ? modelIds.get(model.name) : null,
          loc ? locationIds.get(loc) : null,
          building ? floorIds.get(`${building}:${floor}`) : null,
          orNull(row['IP'] ?? ''),
          status.lifecycle,
          status.dataStatus,
          attributes,
        ],
        'SELECT id FROM net.devices WHERE code = $1',
        [code],
        written,
      );
      deviceIds.set(code, id);
      for (const v of parseVlans(row['VLAN'] ?? '')) {
        const res = await c.query(
          `INSERT INTO net.device_vlans (device_id, vlan_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, vlanIds.get(v.vid)],
        );
        written.n += res.rowCount ?? 0;
      }
    }

    // ---- uplinks, fiber cables, WAN circuits ----
    const fibers = new Map(seed.layout.fibers.map((f) => [f.device, f]));
    const fiberSeq = new Map<string, number>();
    for (const row of seed.devices) {
      const code = row['รหัสในภาพ 3D'] ?? '';
      const parent = orNull(row['ต่อจาก (รหัสในภาพ 3D)'] ?? '');
      if (!parent) continue;
      const media = mediaCode(row['ชนิดสาย'] ?? '');
      const fiber = fibers.get(code);
      let cableId: string | null = null;
      if (fiber) {
        const from = deviceBuilding.get(parent) ?? '';
        const to = deviceBuilding.get(code) ?? '';
        const pair = `${from}-${to}`;
        const seq = (fiberSeq.get(pair) ?? 0) + 1;
        fiberSeq.set(pair, seq);
        const cableCode = fiberCode(from, to, seq);
        const attrs = { color: fiber.color, route: fiber.route, source: 'prototype' };
        cableId = await upsert(
          c,
          `INSERT INTO net.cables (code, kind, a_location_id, b_location_id, route_note, attributes)
           VALUES ($1, 'fiber', (SELECT location_id FROM net.devices WHERE id = $2),
                   (SELECT location_id FROM net.devices WHERE id = $3), $4, $5)
           ON CONFLICT (code) DO UPDATE SET route_note = EXCLUDED.route_note, attributes = EXCLUDED.attributes
           WHERE (net.cables.route_note, net.cables.attributes) IS DISTINCT FROM (EXCLUDED.route_note, EXCLUDED.attributes)
           RETURNING id`,
          [cableCode, deviceIds.get(parent), deviceIds.get(code), fiber.route, attrs],
          'SELECT id FROM net.cables WHERE code = $1',
          [cableCode],
          written,
        );
      }
      const linkId = await upsert(
        c,
        `INSERT INTO net.links (a_device_id, b_device_id, media_code, is_uplink, cable_id, attributes)
         VALUES ($1, $2, $3, true, $4, $5)
         ON CONFLICT (b_device_id) WHERE is_uplink AND deleted_at IS NULL DO UPDATE SET
           a_device_id = EXCLUDED.a_device_id, media_code = EXCLUDED.media_code, cable_id = EXCLUDED.cable_id,
           attributes = EXCLUDED.attributes
         WHERE (net.links.a_device_id, net.links.media_code, net.links.cable_id, net.links.attributes)
           IS DISTINCT FROM (EXCLUDED.a_device_id, EXCLUDED.media_code, EXCLUDED.cable_id, EXCLUDED.attributes)
         RETURNING id`,
        [
          deviceIds.get(parent),
          deviceIds.get(code),
          media,
          cableId,
          { source: 'gsheet_seed', type_label: row['ชนิดสาย'] },
        ],
        'SELECT id FROM net.links WHERE b_device_id = $1 AND is_uplink AND deleted_at IS NULL',
        [deviceIds.get(code)],
        written,
      );
      if (fiber) {
        const res = await c.query(
          `INSERT INTO viz.link_routes (link_id, color) VALUES ($1, $2)
           ON CONFLICT (link_id) DO UPDATE SET color = EXCLUDED.color
           WHERE viz.link_routes.color IS DISTINCT FROM EXCLUDED.color`,
          [linkId, fiber.color],
        );
        written.n += res.rowCount ?? 0;
      }
    }

    for (const w of seed.layout.wan) {
      const res = await c.query(
        `INSERT INTO net.wan_circuits (device_id, provider_org_id, priority, notes) VALUES ($1, $2, $3, $4)
         ON CONFLICT (device_id) DO UPDATE SET provider_org_id = EXCLUDED.provider_org_id,
           priority = EXCLUDED.priority, notes = EXCLUDED.notes
         WHERE (net.wan_circuits.provider_org_id, net.wan_circuits.priority, net.wan_circuits.notes)
           IS DISTINCT FROM (EXCLUDED.provider_org_id, EXCLUDED.priority, EXCLUDED.notes)`,
        [deviceIds.get(w.device), orgIds.get(w.device), w.priority, w.label],
      );
      written.n += res.rowCount ?? 0;
    }

    // ---- 3D: device positions and cable bends of the prototype (M19, fill-only) ----
    const routes = await applyPrototypeRoutes(c, seed.routes);
    written.n += routes.placements + routes.routes;

    const report = await countRows(c, seed);
    await c.query('COMMIT');
    return { ...report, written: written.n };
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

/** Expected counts derived from the seed files vs. what is in the database. */
async function countRows(c: Client, seed: SeedFiles): Promise<Omit<SeedReport, 'written'>> {
  const floors = seed.buildings.reduce((n, b) => n + (toInt(b['จำนวนชั้น'] ?? '') ?? 0), 0);
  const vlans = new Set(seed.devices.flatMap((d) => parseVlans(d['VLAN'] ?? '').map((v) => v.vid)))
    .size;
  const expected = {
    buildings: seed.buildings.length,
    floors,
    locations: seed.areas.length,
    devices: seed.devices.length,
    uplinks: seed.devices.filter((d) => (d['ต่อจาก (รหัสในภาพ 3D)'] ?? '') !== '').length,
    fiber_cables: seed.layout.fibers.length,
    vlans,
    wan_circuits: seed.layout.wan.length,
    staff: seed.layout.staff.length,
    building_shapes: seed.layout.buildings.length,
    area_shapes: seed.layout.areas.length,
  };
  const q = async (sql: string) => Number((await c.query<{ n: string }>(sql)).rows[0]?.n ?? 0);
  const actual = {
    buildings: await q('SELECT count(*) AS n FROM core.buildings WHERE deleted_at IS NULL'),
    floors: await q('SELECT count(*) AS n FROM core.floors'),
    locations: await q('SELECT count(*) AS n FROM core.locations WHERE deleted_at IS NULL'),
    devices: await q('SELECT count(*) AS n FROM net.devices WHERE deleted_at IS NULL'),
    uplinks: await q('SELECT count(*) AS n FROM net.links WHERE is_uplink AND deleted_at IS NULL'),
    fiber_cables: await q(
      `SELECT count(*) AS n FROM net.cables WHERE kind LIKE 'fiber%' AND deleted_at IS NULL`,
    ),
    vlans: await q('SELECT count(*) AS n FROM net.vlans'),
    wan_circuits: await q('SELECT count(*) AS n FROM net.wan_circuits'),
    staff: await q('SELECT count(*) AS n FROM core.staff'),
    building_shapes: await q('SELECT count(*) AS n FROM viz.building_shapes'),
    area_shapes: await q('SELECT count(*) AS n FROM viz.area_shapes'),
  };
  return { expected, actual };
}
