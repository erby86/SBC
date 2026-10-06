// Live feed: what changed between two snapshots (new incident, got worse, recovered), shown as
// short cards over the scene.
import type { StatusSnapshot } from '@sbc-noc/shared';
import { useEffect, useRef, useState } from 'react';

type Incident = StatusSnapshot['incidents'][number];

export interface FeedEvent {
  id: string;
  kind: 'down' | 'warn' | 'ok';
  /** 'new' incident, 'worse' (warn → down), or 'ok' when it is gone. */
  change: 'new' | 'worse' | 'ok';
  device: string;
  at: number;
}

/** Changes from `prev` to `next`; nothing for the first snapshot (prev null). */
/** An incident that started longer ago than this is not reported as new (flapping polls). */
export const NEW_MAX_AGE_MS = 15 * 60_000;

export function diffIncidents(
  prev: readonly Incident[] | null,
  next: readonly Incident[],
  at = Date.now(),
): FeedEvent[] {
  if (!prev) return [];
  const before = new Map(prev.map((i) => [i.device, i]));
  const now = new Set(next.map((i) => i.device));
  const out: FeedEvent[] = [];
  for (const i of next) {
    const p = before.get(i.device);
    if (!p) {
      // a long-running problem that drops out for one poll and comes back is not news
      if (at - Date.parse(i.since) < NEW_MAX_AGE_MS)
        out.push({
          id: `${i.device}@${at}`,
          kind: i.severity,
          change: 'new',
          device: i.device,
          at,
        });
    } else if (p.severity === 'warn' && i.severity === 'down')
      out.push({ id: `${i.device}@${at}`, kind: 'down', change: 'worse', device: i.device, at });
  }
  for (const p of prev)
    if (!now.has(p.device))
      out.push({ id: `${p.device}@${at}`, kind: 'ok', change: 'ok', device: p.device, at });
  // worst first
  const rank = { down: 0, warn: 1, ok: 2 } as const;
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

export const FEED_MS = 9_000;
const FEED_MAX = 4;
/** "Fresh" incident cards (first seen within this time) get a highlight in the panel. */
export const FRESH_MS = 60_000;

/**
 * Feed of changes for one data source (`source` changes → start over, so switching demo
 * scenarios does not flood the screen). Also remembers when each incident was first seen.
 */
export function useIncidentFeed(snap: StatusSnapshot | null, source: string) {
  const prev = useRef<{ source: string; list: readonly Incident[] } | null>(null);
  const firstSeen = useRef(new Map<string, number>());
  const [events, setEvents] = useState<FeedEvent[]>([]);

  useEffect(() => {
    if (!snap) return;
    const p = prev.current?.source === source ? prev.current.list : null;
    if (!p) {
      firstSeen.current = new Map();
      setEvents([]);
    }
    const at = Date.now();
    const ev = diffIncidents(p, snap.incidents, at);
    for (const e of ev) {
      if (e.change === 'ok') firstSeen.current.delete(e.device);
      else firstSeen.current.set(e.device, at);
    }
    prev.current = { source, list: snap.incidents };
    if (ev.length) setEvents((cur) => [...ev, ...cur].slice(0, FEED_MAX));
  }, [snap, source]);

  // expire old cards
  useEffect(() => {
    if (!events.length) return;
    const oldest = Math.min(...events.map((e) => e.at));
    const t = setTimeout(
      () => setEvents((cur) => cur.filter((e) => Date.now() - e.at < FEED_MS)),
      Math.max(200, oldest + FEED_MS - Date.now()),
    );
    return () => clearTimeout(t);
  }, [events]);

  return {
    events,
    dismiss: (id: string) => setEvents((cur) => cur.filter((e) => e.id !== id)),
    isFresh: (device: string, now = Date.now()) => {
      const t = firstSeen.current.get(device);
      return t !== undefined && now - t < FRESH_MS;
    },
  };
}

/** Re-render every `ms` so "12 นาที" keeps counting between snapshots. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
