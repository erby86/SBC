// Console rules of the decluttered layout: priority labels, the "do this first" incident, root-cause
// groups, the folded group of long-standing warnings, and the 24 h timeline bars under the map. Pure
// functions so the rules are tested without a browser.
import { downstreamOf, type StatusHistory, type StatusSnapshot } from '@sbc-noc/shared';

type Incident = StatusSnapshot['incidents'][number];

export type Priority = 'P1' | 'P2' | 'P3';

/** P1 = down and other devices behind it, P2 = down, P3 = should be checked. */
export const priority = (i: Pick<Incident, 'severity' | 'impacted'>): Priority =>
  i.severity === 'down' ? (i.impacted > 0 ? 'P1' : 'P2') : 'P3';

export const PRIORITY_TH: Record<Priority, string> = {
  P1: 'ใช้งานไม่ได้ และกระทบอุปกรณ์อื่น',
  P2: 'ใช้งานไม่ได้',
  P3: 'ควรตรวจสอบ',
};

const DAY = 86_400_000;
/** Warnings older than this fold into "ค้างนานเกิน 7 วัน". */
export const STALE_DAYS = 7;

export const isLongStanding = (i: Pick<Incident, 'severity' | 'since'>, now = Date.now()) =>
  i.severity === 'warn' && now - Date.parse(i.since) > STALE_DAYS * DAY;

/** Incidents shown as cards, and the long-standing warnings folded below them (order kept). */
export function splitIncidents(list: readonly Incident[], now = Date.now()) {
  const main: Incident[] = [];
  const stale: Incident[] = [];
  for (const i of list) (isLongStanding(i, now) ? stale : main).push(i);
  return { main, stale };
}

/** Incidents with a card of their own: root causes and single incidents. A down device behind
 * another down device is listed inside its root cause's group instead. */
export const ownCards = (list: readonly Incident[]): Incident[] =>
  list.filter((i) => i.root === null);

/** The incident to handle first: the first down root cause nobody has taken (list is worst first). */
export const firstToHandle = (list: readonly Incident[]): Incident | null =>
  list.find((i) => i.severity === 'down' && i.root === null && !i.ack) ?? null;

export interface GroupDevice {
  code: string;
  uplink: string | null;
  building: string | null;
}

export interface RootGroup {
  root: string;
  /** Devices behind the root cause that are out with it (down or cut off), registry order. */
  dark: string[];
  /** Out devices per building (null = no building), most first. */
  buildings: { code: string | null; n: number }[];
}

/** What went out with a down root cause: everything below it that is down or cut off now. */
export function rootGroup(
  snap: Pick<StatusSnapshot, 'states'>,
  devices: readonly GroupDevice[],
  root: string,
): RootGroup {
  const children = new Map<string, string[]>();
  for (const d of devices)
    if (d.uplink) children.set(d.uplink, [...(children.get(d.uplink) ?? []), d.code]);
  const below = downstreamOf(children, root);
  const dark = devices
    .filter((d) => below.has(d.code))
    .filter((d) => snap.states[d.code] === 'down' || snap.states[d.code] === 'cut');
  const per = new Map<string | null, number>();
  for (const d of dark) per.set(d.building, (per.get(d.building) ?? 0) + 1);
  const buildings = [...per]
    .map(([code, n]) => ({ code, n }))
    .sort((a, b) => b.n - a.n || String(a.code).localeCompare(String(b.code)));
  return { root, dark: dark.map((d) => d.code), buildings };
}

/** State as drawn: a down device behind a down root cause went out with it, so it shows grey
 * (cut) like the devices cut off; only the root cause is red. */
export function shownState(
  snap: Pick<StatusSnapshot, 'states' | 'incidents'> | null,
  code: string,
): 'ok' | StatusSnapshot['states'][string] {
  const st = snap?.states[code] ?? 'ok';
  return st === 'down' && snap?.incidents.some((i) => i.device === code && i.root !== null)
    ? 'cut'
    : st;
}

/** Top bar numbers: devices out (down + cut off), how many root causes, warnings, not taken. */
export function topCounts(
  snap: Pick<StatusSnapshot, 'counts' | 'incidents' | 'states'>,
  /** Devices on this screen (layout); without it every device of the snapshot counts. */
  known?: (code: string) => boolean,
) {
  const own = ownCards(snap.incidents);
  const out = known
    ? Object.entries(snap.states).filter(([c, st]) => (st === 'down' || st === 'cut') && known(c))
        .length
    : snap.counts.down + snap.counts.cut;
  const roots = own.filter((i) => i.severity === 'down').length;
  return {
    out,
    roots,
    /** Everything out comes from one root cause (badge "จากต้นเหตุเดียว"). */
    oneRoot: roots === 1 && out > 1,
    warn: own.filter((i) => i.severity === 'warn').length,
    open: own.filter((i) => !i.ack).length,
  };
}

export interface TimelineBar {
  device: string | null;
  host: string;
  severity: 'down' | 'warn';
  /** Percent of the window from the left edge, and width (at least a sliver so it shows). */
  left: number;
  width: number;
  open: boolean;
  start: string;
  end: string | null;
  message: string;
}

/** Bars of the last `hours` hours: one per event, clipped to the window, down lane first. */
export function timelineBars(history: StatusHistory | null | undefined, now = Date.now()) {
  if (!history) return { bars: [] as TimelineBar[], from: now, started: 0 };
  const span = history.hours * 3_600_000;
  const from = now - span;
  const pct = (t: number) => ((Math.min(now, Math.max(from, t)) - from) / span) * 100;
  const bars: TimelineBar[] = [];
  let started = 0;
  for (const h of history.events) {
    const s = Date.parse(h.start);
    const e = h.end ? Date.parse(h.end) : now;
    if (e < from || s > now) continue;
    if (s >= from) started += 1;
    const left = pct(s);
    bars.push({
      device: h.device,
      host: h.host,
      severity: h.severity,
      left,
      width: Math.max(0.6, pct(e) - left),
      open: h.end === null,
      start: h.start,
      end: h.end,
      message: h.message,
    });
  }
  bars.sort((a, b) =>
    a.severity === b.severity ? a.left - b.left : a.severity === 'down' ? -1 : 1,
  );
  return { bars, from, started };
}

export interface LogLine {
  at: string;
  /** down/warn = a problem started, ok = it recovered, sys = about the data itself. */
  level: 'down' | 'warn' | 'ok' | 'sys';
  /** Registry device to fly to (the root cause for a folded line); null = not on the map. */
  device: string | null;
  host: string;
  message: string;
  /** Recovery lines: what it was and for how many minutes. */
  was?: 'down' | 'warn';
  outMin?: number;
  /** Folded line: how many devices went out behind `root`. */
  followers?: number;
  root?: string;
}

/** Event log under the map, newest first: a line per problem start and per recovery; devices
 * still out behind a root cause fold into one "+N ตัว" line; a system line on top when the data
 * is not fresh. */
export function logLines(
  history: StatusHistory | null | undefined,
  snap: Pick<StatusSnapshot, 'stale' | 'lastUpdate' | 'incidents'> | null,
  max = 60,
): LogLine[] {
  const rootOf = new Map(
    (snap?.incidents ?? []).filter((i) => i.root !== null).map((i) => [i.device, i.root as string]),
  );
  const lines: LogLine[] = [];
  const folded = new Map<string, { n: number; at: string }>();
  for (const e of history?.events ?? []) {
    const root = e.device && e.end === null ? rootOf.get(e.device) : undefined;
    if (root) {
      const f = folded.get(root) ?? { n: 0, at: e.start };
      f.n += 1;
      if (e.start > f.at) f.at = e.start;
      folded.set(root, f);
      continue;
    }
    lines.push({
      at: e.start,
      level: e.severity,
      device: e.device,
      host: e.host,
      message: e.message,
    });
    if (e.end)
      lines.push({
        at: e.end,
        level: 'ok',
        device: e.device,
        host: e.host,
        message: e.message,
        was: e.severity,
        outMin: Math.max(1, Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60_000)),
      });
  }
  for (const [root, f] of folded)
    lines.push({
      at: f.at,
      level: 'down',
      device: root,
      host: `+${f.n} ตัว`,
      message: root,
      followers: f.n,
      root,
    });
  lines.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (snap?.stale)
    lines.unshift({
      at: snap.lastUpdate,
      level: 'sys',
      device: null,
      host: 'worker',
      message: 'ไม่ได้ข้อมูลใหม่',
    });
  return lines.slice(0, max);
}
