// M15: status engine. Every 30 s: open problems + maintenance from Zabbix, mapped to registry
// devices through core.external_refs (M08), then the shared rules (computeStatus, M38) give the
// snapshot that goes to Redis for the api/WebSocket. When Zabbix cannot be read the previous data
// is kept with its old lastUpdate, so after 2 minutes every screen shows the states as stale.
import type { DbPool } from '@sbc-noc/db';
// M20: every few minutes it also writes the 24 h problem history and the Zabbix hosts that match no
// registry device (status:history, status:unlocated) for the history and "ไม่มีตำแหน่ง" panels.
import {
  computeStatus,
  type HistoryEvent,
  type StatusHistory,
  type StatusInput,
  type StatusSnapshot,
  type TopologyDevice,
  type UnlocatedList,
} from '@sbc-noc/shared';
import type {
  ZabbixClient,
  ZabbixGroupedHost,
  ZabbixProblem,
  ZabbixProblemEvent,
} from '../connectors/zabbix.js';

export const SNAPSHOT_KEY = 'status:snapshot';
export const UPDATES_CHANNEL = 'status:updates';
export const HISTORY_KEY = 'status:history';
export const UNLOCATED_KEY = 'status:unlocated';
export const DEFAULT_POLL_MS = 30_000;
/** History/unlocated change slowly and cost more queries: refresh every 2 minutes. */
export const EXTRAS_EVERY_MS = 2 * 60_000;
export const HISTORY_HOURS = 24;

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

/** Problem events → history rows (warn/down only), newest first; hosts outside the registry keep their name. */
export function historyFromZabbix(
  events: ZabbixProblemEvent[],
  deviceOfHost: Map<string, string>,
  now: Date,
  hours = HISTORY_HOURS,
): StatusHistory {
  const iso = (sec: number) => new Date(sec * 1000).toISOString();
  const rows: HistoryEvent[] = [];
  for (const e of events) {
    const severity = stateOfSeverity(e.severity);
    if (!severity) continue;
    for (const h of e.hosts.length ? e.hosts : [{ hostid: '', name: '?' }]) {
      rows.push({
        device: deviceOfHost.get(h.hostid) ?? null,
        host: h.name,
        severity,
        start: iso(e.clock),
        end: e.endClock === null ? null : iso(e.endClock),
        message: e.name,
      });
    }
  }
  rows.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  return { updatedAt: now.toISOString(), hours, events: rows };
}

/** Zabbix hosts no registry device matches, with their worst open problem. */
export function unlocatedFromZabbix(
  hosts: ZabbixGroupedHost[],
  problems: ZabbixProblem[],
  deviceOfHost: Map<string, string>,
  now: Date,
): UnlocatedList {
  const worst = new Map<string, 'warn' | 'down'>();
  for (const p of problems) {
    const st = stateOfSeverity(p.severity);
    if (!st) continue;
    for (const h of p.hostids) if (worst.get(h) !== 'down') worst.set(h, st);
  }
  return {
    updatedAt: now.toISOString(),
    hosts: hosts
      .filter((h) => !deviceOfHost.has(h.hostid))
      .map((h) => ({
        hostid: h.hostid,
        name: h.name || h.host,
        ip: h.ips[0] ?? null,
        groups: h.groups,
        state: worst.get(h.hostid) ?? ('ok' as const),
      }))
      .sort(
        (a, b) =>
          Number(b.state === 'down') - Number(a.state === 'down') ||
          Number(b.state === 'warn') - Number(a.state === 'warn') ||
          a.name.localeCompare(b.name),
      ),
  };
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
  zabbix: Pick<ZabbixClient, 'problems' | 'hostsInMaintenance'> &
    Partial<Pick<ZabbixClient, 'problemEvents' | 'hostsWithGroups'>>;
  store: SnapshotStore;
  logger: { warn(m: string): void };
  /** Registry reader; tests can replace it. */
  topology?: () => Promise<{ topology: TopologyDevice[]; deviceOfHost: Map<string, string> }>;
}): StatusEngine {
  const readTopology =
    deps.topology ??
    (() => (deps.db ? loadTopology(deps.db) : Promise.reject(new Error('no database'))));
  let last: StatusInput | null = null;
  let problems: ZabbixProblem[] = [];
  let extrasAt = 0;
  const z = deps.zabbix;
  const warn = (what: string, err: unknown) =>
    deps.logger.warn(`status: ${what}: ${err instanceof Error ? err.message : err}`);

  async function refreshExtras(now: Date, deviceOfHost: Map<string, string>) {
    if (now.getTime() - extrasAt < EXTRAS_EVERY_MS) return;
    extrasAt = now.getTime();
    if (z.problemEvents) {
      try {
        const from = Math.floor(now.getTime() / 1000) - HISTORY_HOURS * 3600;
        const h = historyFromZabbix(await z.problemEvents(from), deviceOfHost, now);
        await deps.store.set(HISTORY_KEY, JSON.stringify(h));
      } catch (err) {
        warn('history not readable (role needs event.get)', err);
      }
    }
    if (z.hostsWithGroups) {
      try {
        const u = unlocatedFromZabbix(await z.hostsWithGroups(), problems, deviceOfHost, now);
        await deps.store.set(UNLOCATED_KEY, JSON.stringify(u));
      } catch (err) {
        warn('unlocated hosts not readable', err);
      }
    }
  }

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
        const [open, maint] = await Promise.all([z.problems(), z.hostsInMaintenance()]);
        problems = open;
        last = inputFromZabbix(open, maint, deviceOfHost, now);
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
      await refreshExtras(now, deviceOfHost);
      return snapshot;
    },
  };
}
