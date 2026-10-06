// Console rules of the decluttered layout: priority labels, the "do this first" incident, the
// folded group of long-standing warnings, and the 24 h timeline bars under the map. Pure
// functions so the rules are tested without a browser.
import type { StatusHistory, StatusSnapshot } from '@sbc-noc/shared';

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

/** The incident to handle first: the first down one nobody has taken (list is worst first). */
export const firstToHandle = (list: readonly Incident[]): Incident | null =>
  list.find((i) => i.severity === 'down' && !i.ack) ?? null;

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
