// M08 part 2: write registry tags to Zabbix hosts (ADR-0019). The database is always the source
// (baseline §7). Managed tags: building, floor, loc, role, uplink — other tags on the host are kept.
// Which hosts may be written is enforced by Zabbix permissions of the sync user: dev/staging can
// only write the test group 99-NOC-Test (ADR-0013); prod gets the network groups (M17).
import type { ZabbixClient, ZabbixTag, ZabbixTaggedHost } from '../connectors/zabbix.js';
import type { JobDefinition } from './types.js';
import { matchHosts } from './zabbix-match.js';

export const MANAGED_TAGS = ['building', 'floor', 'loc', 'role', 'uplink'] as const;

export interface DeviceTags {
  id: string;
  code: string;
  hostname: string | null;
  mgmtIp: string | null;
  building: string | null;
  floor: number | null;
  loc: string | null;
  role: string;
  uplink: string | null;
}

/** Desired tag list: unmanaged tags kept as-is, managed tags from the registry (empty values omitted). */
export function desiredTags(current: ZabbixTag[], d: DeviceTags): ZabbixTag[] {
  const managed = new Set<string>(MANAGED_TAGS);
  const kept = current.filter((t) => !managed.has(t.tag));
  const values: Record<(typeof MANAGED_TAGS)[number], string | null> = {
    building: d.building,
    floor: d.floor === null ? null : String(d.floor),
    loc: d.loc,
    role: d.role,
    uplink: d.uplink,
  };
  const ours = MANAGED_TAGS.flatMap((tag) =>
    values[tag] ? [{ tag, value: values[tag] as string }] : [],
  );
  return [...kept, ...ours];
}

const key = (tags: ZabbixTag[]) =>
  JSON.stringify(
    [...tags].sort((a, b) => a.tag.localeCompare(b.tag) || a.value.localeCompare(b.value)),
  );

export function zabbixTagsJob(zabbix: ZabbixClient, groupNames: string[] = []): JobDefinition {
  return {
    name: 'zabbix-tags',
    systemCode: 'zabbix',
    schedule: { every: 15 * 60_000 },
    attempts: 3,
    async run({ db }) {
      const hosts: ZabbixTaggedHost[] = await zabbix.hostsWithTags(groupNames);
      const { rows } = await db.query<{
        id: string;
        code: string;
        hostname: string | null;
        mgmt_ip: string | null;
        building: string | null;
        floor: number | null;
        loc: string | null;
        role: string;
        uplink: string | null;
      }>(
        `SELECT d.id, d.code, d.hostname, host(d.mgmt_ip) AS mgmt_ip,
                b.code AS building, coalesce(f.level, lf.level)::int AS floor, l.loc_code AS loc,
                d.role_code AS role, up.code AS uplink
         FROM net.devices d
         LEFT JOIN core.locations l ON l.id = d.location_id
         LEFT JOIN core.floors lf ON lf.id = l.floor_id
         LEFT JOIN core.floors f ON f.id = d.floor_id
         LEFT JOIN core.buildings b ON b.id = coalesce(f.building_id, lf.building_id)
         LEFT JOIN net.links k ON k.b_device_id = d.id AND k.is_uplink AND k.deleted_at IS NULL
         LEFT JOIN net.devices up ON up.id = k.a_device_id AND up.deleted_at IS NULL
         WHERE d.deleted_at IS NULL AND d.data_status <> 'sample'`,
      );
      const devices: DeviceTags[] = rows.map((r) => ({
        id: r.id,
        code: r.code,
        hostname: r.hostname,
        mgmtIp: r.mgmt_ip,
        building: r.building,
        floor: r.floor,
        loc: r.loc,
        role: r.role,
        uplink: r.uplink,
      }));
      const byId = new Map(devices.map((d) => [d.id, d]));
      const tagged = new Map(hosts.map((h) => [h.hostid, h]));
      const { matches, unmatchedHosts, conflicts } = matchHosts(devices, hosts);

      let updated = 0;
      let unchanged = 0;
      for (const m of matches) {
        const host = tagged.get(m.host.hostid);
        const device = byId.get(m.device.id);
        if (!host || !device) continue;
        const want = desiredTags(host.tags, device);
        if (key(want) === key(host.tags)) {
          unchanged += 1;
          continue;
        }
        await zabbix.setHostTags(host.hostid, want);
        updated += 1;
      }
      return {
        updated,
        detail: {
          groups: groupNames,
          hosts: hosts.length,
          matched: matches.length,
          tags_updated: updated,
          tags_unchanged: unchanged,
          no_position: unmatchedHosts.length,
          conflicts: conflicts.length,
        },
      };
    },
  };
}
