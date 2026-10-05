// Status rules of the NOC (from the prototype, baseline-v8), shared by the status engine (M15),
// the demo mode (M38, ADR-0014) and the web client:
//   maintenance (a device and everything below it) > down > cut off from upstream > warn > ok.
// Only down/warn become incidents; a down device's impact is everything below it in the uplink tree.
import { z } from 'zod';

export const deviceStateSchema = z.enum(['ok', 'warn', 'down', 'cut', 'maint']);
export type DeviceState = z.infer<typeof deviceStateSchema>;

/** Thai labels used on screen (prototype ST_TH). */
export const DEVICE_STATE_TH: Record<DeviceState, string> = {
  ok: 'ปกติ',
  warn: 'ควรตรวจสอบ',
  down: 'ใช้งานไม่ได้',
  cut: 'ขาดการเชื่อมต่อจากต้นทาง',
  maint: 'บำรุงรักษา',
};

export interface TopologyDevice {
  code: string;
  name: string;
  role: string;
  /** Upstream device code (net.links is_uplink), null at the top. */
  uplink: string | null;
}

/** What the engine knows at one moment (M15 builds it from Zabbix; demo mode from fixtures). */
export const statusInputSchema = z.object({
  /** When the source data was last refreshed (Zabbix poll). */
  lastUpdate: z.iso.datetime(),
  signals: z.array(
    z.object({
      device: z.string(),
      severity: z.enum(['down', 'warn']),
      since: z.iso.datetime(),
      message: z.string(),
    }),
  ),
  acks: z.array(
    z.object({ device: z.string(), by: z.string(), note: z.string(), at: z.iso.datetime() }),
  ),
  maintenance: z.array(z.object({ device: z.string(), message: z.string(), by: z.string() })),
  /** PCs online per computer-lab room (LOC code) — information, not alerts. */
  labOnline: z.record(z.string(), z.number().int().nonnegative()),
});
export type StatusInput = z.infer<typeof statusInputSchema>;

export const incidentSchema = z.object({
  device: z.string(),
  severity: z.enum(['down', 'warn']),
  since: z.iso.datetime(),
  message: z.string(),
  /** Devices below this one that lost their path (down only). */
  impacted: z.number().int().nonnegative(),
  ack: z.object({ by: z.string(), note: z.string(), at: z.iso.datetime() }).nullable(),
});
export type Incident = z.infer<typeof incidentSchema>;

export const statusSnapshotSchema = z.object({
  generatedAt: z.iso.datetime(),
  lastUpdate: z.iso.datetime(),
  /** No fresh data for longer than the limit: screens must show states as outdated. */
  stale: z.boolean(),
  /** Every device not ok; devices missing here are ok. */
  states: z.record(z.string(), deviceStateSchema.exclude(['ok'])),
  incidents: z.array(incidentSchema),
  counts: z.record(deviceStateSchema, z.number().int().nonnegative()),
  labOnline: z.record(z.string(), z.number().int().nonnegative()),
  /** Planned work on registry devices (M20 incidents panel); older snapshots have none. */
  maintenance: z
    .array(z.object({ device: z.string(), message: z.string(), by: z.string() }))
    .default([]),
});
export type StatusSnapshot = z.infer<typeof statusSnapshotSchema>;

/** One problem of the last 24 h (M20 history panel); `end` null = not resolved yet. */
export const historyEventSchema = z.object({
  /** Registry device code; null when the Zabbix host is not in the registry. */
  device: z.string().nullable(),
  /** Zabbix host name (device code in demo mode). */
  host: z.string(),
  severity: z.enum(['down', 'warn']),
  start: z.iso.datetime(),
  end: z.iso.datetime().nullable(),
  message: z.string(),
});
export type HistoryEvent = z.infer<typeof historyEventSchema>;

export const statusHistorySchema = z.object({
  updatedAt: z.iso.datetime(),
  hours: z.number().int().positive(),
  /** Newest first. */
  events: z.array(historyEventSchema),
});
export type StatusHistory = z.infer<typeof statusHistorySchema>;

/** A Zabbix host that no registry device matches, so it has no place in the 3D view (M20). */
export const unlocatedHostSchema = z.object({
  hostid: z.string(),
  name: z.string(),
  ip: z.string().nullable(),
  groups: z.array(z.string()),
  state: z.enum(['ok', 'warn', 'down']),
});
export type UnlocatedHost = z.infer<typeof unlocatedHostSchema>;

export const unlocatedListSchema = z.object({
  updatedAt: z.iso.datetime(),
  hosts: z.array(unlocatedHostSchema),
});
export type UnlocatedList = z.infer<typeof unlocatedListSchema>;

/** M15 done-condition: more than 2 minutes without data = stale. */
export const STALE_AFTER_MS = 2 * 60_000;

/** All devices below `code` in the uplink tree (cycle-safe). */
export function downstreamOf(children: Map<string, string[]>, code: string): Set<string> {
  const out = new Set<string>();
  const stack = [...(children.get(code) ?? [])];
  while (stack.length) {
    const c = stack.pop() as string;
    if (out.has(c) || c === code) continue;
    out.add(c);
    stack.push(...(children.get(c) ?? []));
  }
  return out;
}

export function computeStatus(
  topology: TopologyDevice[],
  input: StatusInput,
  now: Date,
  staleAfterMs = STALE_AFTER_MS,
): StatusSnapshot {
  const children = new Map<string, string[]>();
  for (const d of topology) {
    if (d.uplink) children.set(d.uplink, [...(children.get(d.uplink) ?? []), d.code]);
  }
  const known = new Set(topology.map((d) => d.code));
  const signals = new Map(
    input.signals.filter((s) => known.has(s.device)).map((s) => [s.device, s]),
  );

  const maint = new Set<string>();
  for (const m of input.maintenance) {
    if (!known.has(m.device)) continue;
    maint.add(m.device);
    for (const c of downstreamOf(children, m.device)) maint.add(c);
  }
  const cut = new Set<string>();
  for (const [code, s] of signals) {
    if (s.severity === 'down' && !maint.has(code)) {
      for (const c of downstreamOf(children, code)) cut.add(c);
    }
  }

  const stateOf = (code: string): DeviceState => {
    if (maint.has(code)) return 'maint';
    const s = signals.get(code);
    if (s?.severity === 'down') return 'down';
    if (cut.has(code)) return 'cut';
    if (s?.severity === 'warn') return 'warn';
    return 'ok';
  };

  const states: StatusSnapshot['states'] = {};
  const counts: StatusSnapshot['counts'] = { ok: 0, warn: 0, down: 0, cut: 0, maint: 0 };
  for (const d of topology) {
    const st = stateOf(d.code);
    counts[st] += 1;
    if (st !== 'ok') states[d.code] = st;
  }

  const acks = new Map(input.acks.map((a) => [a.device, a]));
  const incidents: Incident[] = [];
  for (const [code, s] of signals) {
    const st = stateOf(code);
    if (st !== 'down' && st !== 'warn') continue;
    const a = acks.get(code);
    incidents.push({
      device: code,
      severity: st,
      since: s.since,
      message: s.message,
      impacted: st === 'down' ? downstreamOf(children, code).size : 0,
      ack: a ? { by: a.by, note: a.note, at: a.at } : null,
    });
  }
  // Down before warn, open before acknowledged, oldest first (prototype order).
  incidents.sort(
    (x, y) =>
      (x.severity === y.severity ? 0 : x.severity === 'down' ? -1 : 1) ||
      Number(x.ack !== null) - Number(y.ack !== null) ||
      Date.parse(x.since) - Date.parse(y.since),
  );

  return {
    generatedAt: now.toISOString(),
    lastUpdate: input.lastUpdate,
    stale: now.getTime() - Date.parse(input.lastUpdate) > staleAfterMs,
    states,
    incidents,
    counts,
    labOnline: input.labOnline,
    maintenance: input.maintenance.filter((m) => known.has(m.device)),
  };
}
