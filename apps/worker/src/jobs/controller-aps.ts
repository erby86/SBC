// M06: import access points from a WLAN controller (UniFi, Omada, ...) into net.devices (role ap),
// managed_by the controller device, keyed by MAC in core.external_refs (system = controller).
// Building and floor come from the AP name, else from its floor switch (ap-placement.ts).
// APs with no floor cannot be stored (net.devices needs a floor or room), so they open one
// `unplaced_ap` issue each for people to fix — preferably by renaming the AP in the controller.
// Existing rows are never moved: a floor/room set by people wins over the name.
import { apCode, placeAp } from './ap-placement.js';
import type { JobDefinition } from './types.js';

/** A device as any controller reports it, normalised by its connector wrapper. */
export interface ControllerDevice {
  mac: string; // lower-case aa:bb:cc:dd:ee:ff
  name: string;
  model: string;
  isAp: boolean;
  ip: string | null;
  version: string | null;
  online: boolean;
  uplinkMac: string | null;
  uplinkPort: number | null;
}

export interface ControllerApsOptions {
  /** Queue job name, e.g. unifi-aps. */
  name: string;
  /** core.source_systems code: unifi, omada, link_ap. */
  system: string;
  /** Shown in issue messages: UniFi, Omada. */
  label: string;
  /** Hint in the error when the controller suddenly lists no APs. */
  configHint: string;
  devices(): Promise<ControllerDevice[]>;
  controller: { code: string; name: string; ip: string | null };
}

interface IssueRow {
  kind: 'unplaced_ap' | 'ip_conflict' | 'missing_in_controller';
  externalId: string;
  message: string;
}

export function controllerApsJob(opts: ControllerApsOptions): JobDefinition {
  const { system, label, controller } = opts;
  const uplinkKey = `${system}_uplink`;
  return {
    name: opts.name,
    systemCode: system,
    schedule: { every: 60 * 60_000 },
    attempts: 3,
    async run({ db, runId }) {
      const all = await opts.devices();
      const aps = all.filter((d) => d.isAp);
      const controllerCode = controller.code;
      const nameByMac = new Map(all.map((d) => [d.mac, d.name || d.model]));

      const c = await db.connect();
      let created = 0;
      let updated = 0;
      const issues: IssueRow[] = [];
      let placed = 0;
      try {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.actor', $1, true)`, [`worker:${opts.name}`]);

        // The controller itself is a registry device (role controller needs no floor).
        const ctl =
          (
            await c.query<{ id: string }>(`SELECT id FROM net.devices WHERE code = $1`, [
              controllerCode,
            ])
          ).rows[0] ??
          (
            await c.query<{ id: string }>(
              `INSERT INTO net.devices (code, display_name, role_code, mgmt_ip)
               VALUES ($1, $2, 'controller',
                       (SELECT $3::inet WHERE $3::inet IS NOT NULL AND NOT EXISTS (
                          SELECT 1 FROM net.devices WHERE mgmt_ip = $3::inet AND deleted_at IS NULL)))
               RETURNING id`,
              [controllerCode, controller.name, controller.ip],
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

        // Existing devices: by controller ref first, then by MAC (a device registered by hand).
        const refs = new Map<string, string>();
        for (const r of (
          await c.query<{ external_id: string; entity_id: string }>(
            `SELECT x.external_id, x.entity_id FROM core.external_refs x
             JOIN net.devices d ON d.id = x.entity_id AND d.deleted_at IS NULL
             WHERE x.system_code = $1 AND x.entity_table = 'net.devices'`,
            [system],
          )
        ).rows) {
          refs.set(r.external_id, r.entity_id);
        }
        // An empty answer after a controller move (wrong site, new controller) must not mark every
        // AP as gone: fail the run instead so it shows up in sync.runs.
        if (aps.length === 0 && refs.size > 0) {
          throw new Error(
            `${system}: controller lists no APs but ${refs.size} are registered — check ${opts.configHint}`,
          );
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
        function ipFor(ap: ControllerDevice, deviceId: string | null): string | null {
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
                 attributes = jsonb_set(attributes, ARRAY[$10::text], $9::jsonb),
                 updated_at = now(), row_version = row_version + 1
               WHERE id = $1 AND (hostname, mgmt_ip, mac, firmware_version, model_id, managed_by_device_id,
                                  attributes->$10::text)
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
                uplinkKey,
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
                { source: system, floor_from: place.from, [uplinkKey]: uplink },
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
                : `AP "${ap.name}" (${ap.mac}, ${ap.ip ?? 'ไม่มี IP'}): ชื่อไม่บอกอาคาร/ชั้น — ตั้งชื่อใน ${label} ใหม่ หรือเพิ่มในทะเบียนพร้อม MAC`,
            });
            continue;
          }

          // The MAC may still point at a row people deleted: move the ref to the live device.
          await c.query(
            `DELETE FROM core.external_refs WHERE system_code = $3 AND entity_table = 'net.devices'
               AND external_id = $1 AND entity_id <> $2`,
            [ap.mac, deviceId, system],
          );
          await c.query(
            `INSERT INTO core.external_refs (entity_table, entity_id, system_code, external_id, external_key, last_seen_at)
             VALUES ('net.devices', $1, $4, $2, $3, now())
             ON CONFLICT (entity_table, entity_id, system_code) DO UPDATE
               SET external_id = EXCLUDED.external_id, external_key = EXCLUDED.external_key, last_seen_at = now()`,
            [deviceId, ap.mac, ap.name, system],
          );
        }

        // APs we imported before that the controller no longer lists.
        const gone = await c.query<{ external_id: string; external_key: string | null }>(
          `SELECT external_id, external_key FROM core.external_refs
           WHERE system_code = $2 AND entity_table = 'net.devices' AND NOT (external_id = ANY($1::text[]))
             AND entity_id IN (SELECT id FROM net.devices WHERE deleted_at IS NULL)`,
          [seen, system],
        );
        for (const g of gone.rows) {
          issues.push({
            kind: 'missing_in_controller',
            externalId: g.external_id,
            message: `AP "${g.external_key ?? g.external_id}" ไม่อยู่ใน ${label} แล้ว — ถอดออกหรือย้าย site?`,
          });
        }

        // One open issue per (kind, MAC); resolve the ones that no longer apply.
        for (const i of issues) {
          await c.query(
            `INSERT INTO sync.issues (run_id, system_code, kind, external_id, message)
             SELECT $1, $5, $2, $3, $4
             WHERE NOT EXISTS (SELECT 1 FROM sync.issues WHERE system_code = $5 AND kind = $2
                               AND external_id = $3 AND resolved_at IS NULL)`,
            [runId, i.kind, i.externalId, i.message, system],
          );
        }
        await c.query(
          `UPDATE sync.issues SET resolved_at = now()
           WHERE system_code = $2 AND resolved_at IS NULL
             AND kind IN ('unplaced_ap', 'ip_conflict', 'missing_in_controller')
             AND NOT ((kind || '/' || external_id) = ANY($1::text[]))`,
          [issues.map((i) => `${i.kind}/${i.externalId}`), system],
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
          online: aps.filter((a) => a.online).length,
          placed,
          unplaced: count('unplaced_ap'),
          ip_conflicts: count('ip_conflict'),
          missing_in_controller: count('missing_in_controller'),
        },
      };
    },
  };
}
