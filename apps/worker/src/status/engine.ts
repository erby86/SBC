// M15: status engine. Every 30 s: open problems + maintenance from Zabbix, mapped to registry
// devices through core.external_refs (M08), then the shared rules (computeStatus, M38) give the
// snapshot that goes to Redis for the api/WebSocket. When Zabbix cannot be read the previous data
// is kept with its old lastUpdate, so after 2 minutes every screen shows the states as stale.
import type { DbPool } from '@sbc-noc/db';
import {
  computeStatus,
  type StatusInput,
  type StatusSnapshot,
  type TopologyDevice,
} from '@sbc-noc/shared';
import type { ZabbixClient, ZabbixProblem } from '../connectors/zabbix.js';

export const SNAPSHOT_KEY = 'status:snapshot';
export const UPDATES_CHANNEL = 'status:updates';
export const DEFAULT_POLL_MS = 30_000;

/** Zabbix severity → NOC state: High/Disaster = down, Warning/Average = warn, lower = ignored. */
export function stateOfSeverity(severity: number): 'down' | 'warn' | null {
  if (severity >= 4) return 'down';
  if (severity >= 2) return 'warn';
  return null;
}

/**
 * Zabbix problems/maintenance → engine input for registry devices. Several problems on one device
 * collapse into the worst one (oldest first within it); hosts not in the registry are skipped
 * (they are listed by M08 as unmatched_host).
 */
export function inputFromZabbix(
  problems: ZabbixProblem[],
  maintenance: { hostid: string; name: string }[],
  deviceOfHost: Map<string, string>,
  now: Date,
): StatusInput {
  type Pick = { p: ZabbixProblem; state: 'down' | 'warn'; extra: number };
  const best = new Map<string, Pick>();
  for (const p of problems) {
    const state = stateOfSeverity(p.severity);
    if (!state) continue;
    for (const hostid of p.hostids) {
      const device = deviceOfHost.get(hostid);
      if (!device) continue;
      const cur = best.get(device);
      if (!cur) {
        best.set(device, { p, state, extra: 0 });
        continue;
      }
      const worse =
        (state === 'down' && cur.state === 'warn') ||
        (state === cur.state && p.clock < cur.p.clock);
      best.set(
        device,
        worse ? { p, state, extra: cur.extra + 1 } : { ...cur, extra: cur.extra + 1 },
      );
    }
  }
  const iso = (sec: number) => new Date(sec * 1000).toISOString();
  const signals: StatusInput['signals'] = [];
  const acks: StatusInput['acks'] = [];
  for (const [device, { p, state, extra }] of best) {
    signals.push({
      device,
      severity: state,
      since: iso(p.clock),
      message: extra ? `${p.name} (+${extra} ปัญหา)` : p.name,
    });
    if (p.acknowledged) {
      acks.push({
        device,
        by: p.ack ? `zabbix:${p.ack.userid}` : 'zabbix',
        note: p.ack?.message ?? '',
        at: p.ack ? iso(p.ack.clock) : iso(p.clock),
      });
    }
  }
  const maint: StatusInput['maintenance'] = [];
  for (const m of maintenance) {
    const device = deviceOfHost.get(m.hostid);
    if (device) maint.push({ device, message: m.name, by: 'Zabbix' });
  }
  return { lastUpdate: now.toISOString(), signals, acks, maintenance: maint, labOnline: {} };
}

/** Registry uplink tree + Zabbix host → device code (only live, non-sample devices). */
export async function loadTopology(
  db: DbPool,
): Promise<{ topology: TopologyDevice[]; deviceOfHost: Map<string, string> }> {
  const devices = await db.query<{
    code: string;
    name: string;
    role: string;
    uplink: string | null;
  }>(
    `SELECT d.code, d.display_name AS name, d.role_code AS role, up.code AS uplink
     FROM net.devices d
     LEFT JOIN net.links k ON k.b_device_id = d.id AND k.is_uplink AND k.deleted_at IS NULL
     LEFT JOIN net.devices up ON up.id = k.a_device_id AND up.deleted_at IS NULL AND up.data_status <> 'sample'
     WHERE d.deleted_at IS NULL AND d.data_status <> 'sample'`,
  );
  const refs = await db.query<{ hostid: string; code: string }>(
    `SELECT x.external_id AS hostid, d.code FROM core.external_refs x
     JOIN net.devices d ON d.id = x.entity_id AND d.deleted_at IS NULL AND d.data_status <> 'sample'
     WHERE x.system_code = 'zabbix' AND x.entity_table = 'net.devices'`,
  );
  return {
    topology: devices.rows,
    deviceOfHost: new Map(refs.rows.map((r) => [r.hostid, r.code])),
  };
}

/** Redis surface used by the engine (ioredis-compatible). */
export interface SnapshotStore {
  set(key: string, value: string): Promise<unknown>;
  publish(channel: string, message: string): Promise<unknown>;
}

export interface StatusEngine {
  /** One poll; never throws (errors are logged and leave the data to go stale). */
  tick(now?: Date): Promise<StatusSnapshot | null>;
}

export function createStatusEngine(deps: {
  db: DbPool | null;
  zabbix: Pick<ZabbixClient, 'problems' | 'hostsInMaintenance'>;
  store: SnapshotStore;
  logger: { warn(m: string): void };
  /** Registry reader; tests can replace it. */
  topology?: () => Promise<{ topology: TopologyDevice[]; deviceOfHost: Map<string, string> }>;
}): StatusEngine {
  const readTopology =
    deps.topology ??
    (() => (deps.db ? loadTopology(deps.db) : Promise.reject(new Error('no database'))));
  let last: StatusInput | null = null;
  return {
    async tick(now = new Date()) {
      let topology: TopologyDevice[];
      let deviceOfHost: Map<string, string>;
      try {
        ({ topology, deviceOfHost } = await readTopology());
      } catch (err) {
        deps.logger.warn(
          `status: registry not readable: ${err instanceof Error ? err.message : err}`,
        );
        return null;
      }
      try {
        const [problems, maint] = await Promise.all([
          deps.zabbix.problems(),
          deps.zabbix.hostsInMaintenance(),
        ]);
        last = inputFromZabbix(problems, maint, deviceOfHost, now);
      } catch (err) {
        deps.logger.warn(
          `status: zabbix not readable: ${err instanceof Error ? err.message : err}`,
        );
        if (!last) return null;
      }
      const snapshot = computeStatus(topology, last as StatusInput, now);
      const json = JSON.stringify(snapshot);
      try {
        await deps.store.set(SNAPSHOT_KEY, json);
        await deps.store.publish(UPDATES_CHANNEL, json);
      } catch (err) {
        deps.logger.warn(`status: redis write failed: ${err instanceof Error ? err.message : err}`);
      }
      return snapshot;
    },
  };
}
