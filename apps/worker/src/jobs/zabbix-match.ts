// M08 part 1: pair registry devices with Zabbix hosts (read-only on Zabbix).
// Match by management IP first, then by hostname. Results go to core.external_refs;
// Zabbix hosts that match nothing open one `unmatched_host` issue each (deduplicated).
import type { ZabbixClient, ZabbixHost } from '../connectors/zabbix.js';
import type { JobDefinition } from './types.js';

export interface RegistryDevice {
  id: string;
  code: string;
  hostname: string | null;
  mgmtIp: string | null;
}

export interface MatchResult {
  matches: { device: RegistryDevice; host: ZabbixHost; by: 'ip' | 'hostname' }[];
  unmatchedHosts: ZabbixHost[];
  conflicts: { host: ZabbixHost; reason: string }[];
}

/** Pure matching so the rules are unit-testable. Each host and each device is used at most once. */
export function matchHosts(devices: RegistryDevice[], hosts: ZabbixHost[]): MatchResult {
  const byIp = new Map<string, RegistryDevice[]>();
  const byName = new Map<string, RegistryDevice[]>();
  for (const d of devices) {
    if (d.mgmtIp) byIp.set(d.mgmtIp, [...(byIp.get(d.mgmtIp) ?? []), d]);
    if (d.hostname) {
      const k = d.hostname.toLowerCase();
      byName.set(k, [...(byName.get(k) ?? []), d]);
    }
  }
  const used = new Set<string>();
  const result: MatchResult = { matches: [], unmatchedHosts: [], conflicts: [] };
  for (const host of hosts) {
    const ipCandidates = [...new Set(host.ips.flatMap((ip) => byIp.get(ip) ?? []))];
    const nameCandidates = byName.get(host.host.toLowerCase()) ?? [];
    const [candidates, by] = ipCandidates.length
      ? [ipCandidates, 'ip' as const]
      : [nameCandidates, 'hostname' as const];
    if (candidates.length === 0) {
      result.unmatchedHosts.push(host);
    } else if (candidates.length > 1) {
      result.conflicts.push({
        host,
        reason: `${by} ตรงกับหลายอุปกรณ์: ${candidates.map((d) => d.code).join(', ')}`,
      });
    } else {
      const device = candidates[0] as RegistryDevice;
      if (used.has(device.id)) {
        result.conflicts.push({
          host,
          reason: `อุปกรณ์ ${device.code} ถูกจับคู่กับ host อื่นแล้ว`,
        });
      } else {
        used.add(device.id);
        result.matches.push({ device, host, by });
      }
    }
  }
  return result;
}

export function zabbixMatchJob(zabbix: ZabbixClient): JobDefinition {
  return {
    name: 'zabbix-match',
    systemCode: 'zabbix',
    schedule: { every: 15 * 60_000 },
    attempts: 3,
    async run({ db, runId }) {
      const hosts = await zabbix.hosts();
      const { rows } = await db.query<{
        id: string;
        code: string;
        hostname: string | null;
        mgmt_ip: string | null;
      }>(
        `SELECT id, code, hostname, host(mgmt_ip) AS mgmt_ip FROM net.devices
         WHERE deleted_at IS NULL AND data_status <> 'sample'`,
      );
      const result = matchHosts(
        rows.map((r) => ({ id: r.id, code: r.code, hostname: r.hostname, mgmtIp: r.mgmt_ip })),
        hosts,
      );

      const c = await db.connect();
      let created = 0;
      let updated = 0;
      try {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.actor', 'worker:zabbix-match', true)`);
        for (const m of result.matches) {
          // A host re-paired to another device: drop the old pairing first (unique per external id).
          await c.query(
            `DELETE FROM core.external_refs WHERE system_code = 'zabbix' AND entity_table = 'net.devices'
               AND external_id = $1 AND entity_id <> $2`,
            [m.host.hostid, m.device.id],
          );
          const res = await c.query<{ inserted: boolean }>(
            `INSERT INTO core.external_refs (entity_table, entity_id, system_code, external_id, external_key, last_seen_at)
             VALUES ('net.devices', $1, 'zabbix', $2, $3, now())
             ON CONFLICT (entity_table, entity_id, system_code) DO UPDATE
               SET external_id = EXCLUDED.external_id, external_key = EXCLUDED.external_key, last_seen_at = now()
             RETURNING (xmax = 0) AS inserted`,
            [m.device.id, m.host.hostid, m.host.host],
          );
          if (res.rows[0]?.inserted) created += 1;
          else updated += 1;
        }

        // Issues: one open row per Zabbix host; resolve the ones that are now matched.
        const open = [
          ...result.unmatchedHosts.map((h) => ({
            h,
            kind: 'unmatched_host',
            msg: `host "${h.host}" (${h.ips.join(', ') || 'ไม่มี IP'}) ไม่ตรงกับอุปกรณ์ในทะเบียน`,
          })),
          ...result.conflicts.map((x) => ({
            h: x.host,
            kind: 'ip_conflict',
            msg: `host "${x.host.host}": ${x.reason}`,
          })),
        ];
        for (const o of open) {
          await c.query(
            `INSERT INTO sync.issues (run_id, system_code, kind, external_id, message)
             SELECT $1, 'zabbix', $2, $3, $4
             WHERE NOT EXISTS (SELECT 1 FROM sync.issues WHERE system_code = 'zabbix' AND kind = $2
                               AND external_id = $3 AND resolved_at IS NULL)`,
            [runId, o.kind, o.h.hostid, o.msg],
          );
        }
        await c.query(
          `UPDATE sync.issues SET resolved_at = now()
           WHERE system_code = 'zabbix' AND kind IN ('unmatched_host', 'ip_conflict') AND resolved_at IS NULL
             AND NOT (external_id = ANY($1::text[]))`,
          [open.map((o) => o.h.hostid)],
        );
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK');
        throw err;
      } finally {
        c.release();
      }

      return {
        created,
        updated,
        errors: result.conflicts.length,
        detail: {
          zabbix_hosts: hosts.length,
          matched: result.matches.length,
          matched_by_ip: result.matches.filter((m) => m.by === 'ip').length,
          unmatched_hosts: result.unmatchedHosts.length,
          conflicts: result.conflicts.length,
        },
      };
    },
  };
}
