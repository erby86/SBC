// M06 (UniFi part): import access points from the UniFi controller into net.devices (role ap),
// managed_by the controller device, keyed by MAC in core.external_refs (system unifi).
// Building and floor come from the AP name (naming in use on 2026-10-03, see NAME_RULES).
// APs whose name gives no floor cannot be stored (net.devices needs a floor or room), so they
// open one `unplaced_ap` issue each for people to fix — preferably by renaming the AP in UniFi.
// Existing rows are never moved: a floor/room set by people wins over the name.
import type { UnifiClient, UnifiDevice } from '../connectors/unifi.js';
import type { JobDefinition } from './types.js';

export const CONTROLLER_CODE = 'ctl-unifi';

/** AP name → building + floor (+ number on the floor). Named groups b (building), f, n. First match wins. */
export const NAME_RULES: { re: RegExp; building?: string }[] = [
  // Uniform name for any building, free text allowed after it: "SP-3-1 Canteen", "BB-1-1 ITB"
  { re: /^(?<b>sp|i2|i1|b1|b2|s8|ba|bb)-(?<f>\d{1,2})-(?<n>\d+)(?:\s.*)?$/i },
  { re: /^8SFL(?<f>\d{1,2})-(?<n>\d+)$/i, building: 's8' }, // 8SFL2-1 = 8 เซียน ชั้น 2 ตัวที่ 1
  { re: /^AF?(?<f>\d{1,2})-(?<n>\d+)$/i, building: 'ba' }, // A6-1, AF2-1201 = อาคาร A
  { re: /^BF?L?(?<f>\d{1,2})-(?<n>\d+)$/i, building: 'bb' }, // BFL3-1, BF5-2 = อาคาร B
  { re: /^UAP-AC-7AP(?<f>\d{1,2})F$/i, building: 'ba' }, // UAP-AC-7AP1F = อาคาร A (7 ชั้น) ชั้น 1
];

/**
 * Switches that serve only their own floor: an AP with no usable name takes the switch's floor.
 * Not the building main switches (e.g. US24AFL-4 = m-a4), whose cables run to several floors.
 */
export const FLOOR_SWITCH_RULES: { re: RegExp; building: string }[] = [
  { re: /^US\d+BFL-(?<f>\d{1,2})$/i, building: 'bb' }, // US16BFL-4 = อาคาร B ชั้น 4
];

export interface ApPlace {
  building: string;
  floor: number;
  no: string;
  from: 'name' | 'uplink';
}

function match(
  rules: { re: RegExp; building?: string }[],
  name: string,
): { building: string; floor: number; n?: string | undefined } | null {
  for (const { re, building } of rules) {
    const g = re.exec(name.trim())?.groups;
    const b = building ?? g?.['b']?.toLowerCase();
    if (g && b) return { building: b, floor: Number(g['f']), n: g['n'] };
  }
  return null;
}

export function parseApName(name: string): ApPlace | null {
  const m = match(NAME_RULES, name);
  return m && { building: m.building, floor: m.floor, no: String(Number(m.n ?? 1)), from: 'name' };
}

/** Name first, then the floor switch the AP is cabled to (number = switch port). */
export function placeAp(
  ap: Pick<UnifiDevice, 'name' | 'uplinkMac' | 'uplinkPort'>,
  nameByMac: Map<string, string>,
): ApPlace | null {
  const byName = parseApName(ap.name);
  if (byName) return byName;
  const sw = ap.uplinkMac ? nameByMac.get(ap.uplinkMac) : undefined;
  const m = sw ? match(FLOOR_SWITCH_RULES, sw) : null;
  return (
    m && { building: m.building, floor: m.floor, no: `p${ap.uplinkPort ?? 0}`, from: 'uplink' }
  );
}

export function apCode(p: Pick<ApPlace, 'building' | 'floor' | 'no'>): string {
  return `ap-${p.building}-${p.floor}-${p.no}`;
}

interface IssueRow {
  kind: 'unplaced_ap' | 'ip_conflict' | 'missing_in_controller';
  externalId: string;
  message: string;
}

export function unifiApsJob(
  unifi: UnifiClient,
  controller: { name: string; ip: string | null },
): JobDefinition {
  return {
    name: 'unifi-aps',
    systemCode: 'unifi',
    schedule: { every: 60 * 60_000 },
    attempts: 3,
    async run({ db, runId }) {
      const all = await unifi.devices();
      const aps = all.filter((d) => d.type === 'uap');
      const nameByMac = new Map(all.map((d) => [d.mac, d.name || d.model]));

      const c = await db.connect();
      let created = 0;
      let updated = 0;
      const issues: IssueRow[] = [];
      let placed = 0;
      try {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.actor', 'worker:unifi-aps', true)`);

        // The controller itself is a registry device (role controller needs no floor).
        const ctl =
          (
            await c.query<{ id: string }>(`SELECT id FROM net.devices WHERE code = $1`, [
              CONTROLLER_CODE,
            ])
          ).rows[0] ??
          (
            await c.query<{ id: string }>(
              `INSERT INTO net.devices (code, display_name, role_code, mgmt_ip)
               VALUES ($1, $2, 'controller',
                       (SELECT $3::inet WHERE $3::inet IS NOT NULL AND NOT EXISTS (
                          SELECT 1 FROM net.devices WHERE mgmt_ip = $3::inet AND deleted_at IS NULL)))
               RETURNING id`,
              [CONTROLLER_CODE, controller.name, controller.ip],
            )
          ).rows[0];
        const controllerId = ctl?.id as string;

        const floors = new Map<string, { id: string; name: string }>();
        for (const r of (
          await c.query<{ building: string; level: number; floor_id: string; name: string }>(
            `SELECT b.code AS building, f.level, f.id AS floor_id, b.name
             FROM core.floors f JOIN core.buildings b ON b.id = f.building_id`,
          )
        ).rows) {
          floors.set(`${r.building}/${r.level}`, { id: r.floor_id, name: r.name });
        }

        // Existing devices: by UniFi ref first, then by MAC (a device registered by hand).
        const refs = new Map<string, string>();
        for (const r of (
          await c.query<{ external_id: string; entity_id: string }>(
            `SELECT x.external_id, x.entity_id FROM core.external_refs x
             JOIN net.devices d ON d.id = x.entity_id AND d.deleted_at IS NULL
             WHERE x.system_code = 'unifi' AND x.entity_table = 'net.devices'`,
          )
        ).rows) {
          refs.set(r.external_id, r.entity_id);
        }
        const byMac = new Map<string, string>();
        const byIp = new Map<string, string>();
        for (const r of (
          await c.query<{ id: string; mac: string | null; ip: string | null }>(
            `SELECT id, mac::text AS mac, host(mgmt_ip) AS ip FROM net.devices WHERE deleted_at IS NULL`,
          )
        ).rows) {
          if (r.mac) byMac.set(r.mac, r.id);
          if (r.ip) byIp.set(r.ip, r.id);
        }

        const modelIds = new Map<string, number>();
        async function modelId(name: string): Promise<number | null> {
          if (!name) return null;
          const known = modelIds.get(name);
          if (known) return known;
          const found = await c.query<{ id: number }>(
            `SELECT id FROM catalog.models WHERE name = $1 AND kind = 'ap' ORDER BY id LIMIT 1`,
            [name],
          );
          const id =
            found.rows[0]?.id ??
            (
              await c.query<{ id: number }>(
                `INSERT INTO catalog.models (name, kind) VALUES ($1, 'ap') RETURNING id`,
                [name],
              )
            ).rows[0]?.id;
          if (id) modelIds.set(name, id);
          return id ?? null;
        }

        /** The AP's IP unless another device already owns it (mgmt_ip is unique). */
        function ipFor(ap: UnifiDevice, deviceId: string | null): string | null {
          if (!ap.ip) return null;
          const owner = byIp.get(ap.ip);
          if (owner && owner !== deviceId) {
            issues.push({
              kind: 'ip_conflict',
              externalId: ap.mac,
              message: `AP "${ap.name}" (${ap.mac}) ใช้ IP ${ap.ip} ซ้ำกับอุปกรณ์อื่นในทะเบียน`,
            });
            return null;
          }
          return ap.ip;
        }

        const seen: string[] = [];
        for (const ap of aps) {
          seen.push(ap.mac);
          const place = placeAp(ap, nameByMac);
          const uplink = ap.uplinkMac
            ? { device: nameByMac.get(ap.uplinkMac) ?? ap.uplinkMac, port: ap.uplinkPort }
            : null;
          const floor = place ? floors.get(`${place.building}/${place.floor}`) : undefined;
          let deviceId = refs.get(ap.mac) ?? byMac.get(ap.mac) ?? null;
          const model = await modelId(ap.model);

          if (deviceId) {
            const res = await c.query(
              `UPDATE net.devices SET hostname = $2, mgmt_ip = $3, mac = $4, firmware_version = $5,
                 model_id = coalesce($6, model_id), managed_by_device_id = $7,
                 floor_id = CASE WHEN location_id IS NULL AND floor_id IS NULL THEN $8 ELSE floor_id END,
                 attributes = jsonb_set(attributes, '{unifi_uplink}', $9::jsonb),
                 updated_at = now(), row_version = row_version + 1
               WHERE id = $1 AND (hostname, mgmt_ip, mac, firmware_version, model_id, managed_by_device_id,
                                  attributes->'unifi_uplink')
                 IS DISTINCT FROM ($2, $3::inet, $4::macaddr, $5, coalesce($6, model_id), $7, $9::jsonb)`,
              [
                deviceId,
                ap.name,
                ipFor(ap, deviceId),
                ap.mac,
                ap.version,
                model,
                controllerId,
                floor?.id ?? null,
                JSON.stringify(uplink),
              ],
            );
            updated += res.rowCount ?? 0;
            placed += 1;
          } else if (place && floor) {
            // Codes are never reused (also not those of deleted rows): add the MAC tail on clash.
            let code = apCode(place);
            const taken = await c.query(`SELECT 1 FROM net.devices WHERE code = $1`, [code]);
            if (taken.rowCount) code = `${code}-${ap.mac.replace(/:/g, '').slice(-4)}`;
            const ins = await c.query<{ id: string }>(
              `INSERT INTO net.devices (code, display_name, hostname, role_code, model_id, floor_id,
                 managed_by_device_id, poe_powered, mgmt_ip, mac, firmware_version, attributes)
               VALUES ($1, $2, $3, 'ap', $4, $5, $6, true, $7, $8, $9, $10)
               RETURNING id`,
              [
                code,
                `AP ${floor.name} ชั้น ${place.floor} #${place.no}`,
                ap.name,
                model,
                floor.id,
                controllerId,
                ipFor(ap, null),
                ap.mac,
                ap.version,
                { source: 'unifi', floor_from: place.from, unifi_uplink: uplink },
              ],
            );
            deviceId = ins.rows[0]?.id as string;
            if (ap.ip) byIp.set(ap.ip, deviceId);
            created += 1;
            placed += 1;
          } else {
            issues.push({
              kind: 'unplaced_ap',
              externalId: ap.mac,
              message: place
                ? `AP "${ap.name}" (${ap.mac}, ${ap.ip ?? 'ไม่มี IP'}): ไม่มีชั้น ${place.floor} ในอาคาร ${place.building}`
                : `AP "${ap.name}" (${ap.mac}, ${ap.ip ?? 'ไม่มี IP'}): ชื่อไม่บอกอาคาร/ชั้น — ตั้งชื่อใน UniFi ใหม่ หรือเพิ่มในทะเบียนพร้อม MAC`,
            });
            continue;
          }

          // The MAC may still point at a row people deleted: move the ref to the live device.
          await c.query(
            `DELETE FROM core.external_refs WHERE system_code = 'unifi' AND entity_table = 'net.devices'
               AND external_id = $1 AND entity_id <> $2`,
            [ap.mac, deviceId],
          );
          await c.query(
            `INSERT INTO core.external_refs (entity_table, entity_id, system_code, external_id, external_key, last_seen_at)
             VALUES ('net.devices', $1, 'unifi', $2, $3, now())
             ON CONFLICT (entity_table, entity_id, system_code) DO UPDATE
               SET external_id = EXCLUDED.external_id, external_key = EXCLUDED.external_key, last_seen_at = now()`,
            [deviceId, ap.mac, ap.name],
          );
        }

        // APs we imported before that the controller no longer lists.
        const gone = await c.query<{ external_id: string; external_key: string | null }>(
          `SELECT external_id, external_key FROM core.external_refs
           WHERE system_code = 'unifi' AND entity_table = 'net.devices' AND NOT (external_id = ANY($1::text[]))
             AND entity_id IN (SELECT id FROM net.devices WHERE deleted_at IS NULL)`,
          [seen],
        );
        for (const g of gone.rows) {
          issues.push({
            kind: 'missing_in_controller',
            externalId: g.external_id,
            message: `AP "${g.external_key ?? g.external_id}" ไม่อยู่ใน UniFi แล้ว — ถอดออกหรือย้าย site?`,
          });
        }

        // One open issue per (kind, MAC); resolve the ones that no longer apply.
        for (const i of issues) {
          await c.query(
            `INSERT INTO sync.issues (run_id, system_code, kind, external_id, message)
             SELECT $1, 'unifi', $2, $3, $4
             WHERE NOT EXISTS (SELECT 1 FROM sync.issues WHERE system_code = 'unifi' AND kind = $2
                               AND external_id = $3 AND resolved_at IS NULL)`,
            [runId, i.kind, i.externalId, i.message],
          );
        }
        await c.query(
          `UPDATE sync.issues SET resolved_at = now()
           WHERE system_code = 'unifi' AND resolved_at IS NULL
             AND kind IN ('unplaced_ap', 'ip_conflict', 'missing_in_controller')
             AND NOT ((kind || '/' || external_id) = ANY($1::text[]))`,
          [issues.map((i) => `${i.kind}/${i.externalId}`)],
        );
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK');
        throw err;
      } finally {
        c.release();
      }

      const count = (k: IssueRow['kind']) => issues.filter((i) => i.kind === k).length;
      return {
        created,
        updated,
        errors: count('ip_conflict'),
        detail: {
          controller_aps: aps.length,
          online: aps.filter((a) => a.state === 1).length,
          placed,
          unplaced: count('unplaced_ap'),
          ip_conflicts: count('ip_conflict'),
          missing_in_controller: count('missing_in_controller'),
        },
      };
    },
  };
}
