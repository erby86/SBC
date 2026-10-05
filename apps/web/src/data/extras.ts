// M20: data of the side panels besides the live snapshot — 24 h history and Zabbix hosts without
// a registry position (written by the worker every 2 minutes) — and the demo mode (M38, ADR-0014),
// which replaces all of them with a scenario and must never pass for the real network.
import {
  statusHistorySchema,
  statusSnapshotSchema,
  unlocatedListSchema,
  type StatusHistory,
  type StatusSnapshot,
  type UnlocatedList,
} from '@sbc-noc/shared';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

/** 503 = the worker has not written it yet (null); other errors throw. */
async function getOptional<T>(url: string, parse: (v: unknown) => T): Promise<T | null> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 503) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return parse(await res.json());
}

export function useHistory(enabled: boolean) {
  return useQuery<StatusHistory | null>({
    queryKey: ['status-history'],
    queryFn: () => getOptional('/api/status/history', (v) => statusHistorySchema.parse(v)),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useUnlocated(enabled: boolean) {
  return useQuery<UnlocatedList | null>({
    queryKey: ['status-unlocated'],
    queryFn: () => getOptional('/api/status/unlocated', (v) => unlocatedListSchema.parse(v)),
    enabled,
    refetchInterval: 60_000,
  });
}

const scenarioMeta = z.object({ name: z.string(), title: z.string(), description: z.string() });
const demoListSchema = z.object({
  demo: z.literal(true),
  label: z.string(),
  scenarios: z.array(scenarioMeta),
});
const demoScenarioSchema = z.object({
  demo: z.literal(true),
  label: z.string(),
  scenario: scenarioMeta,
  snapshot: statusSnapshotSchema,
  unlocated: unlocatedListSchema,
  history: statusHistorySchema,
});
export type DemoData = z.infer<typeof demoScenarioSchema>;

/** `?demo` or `?demo=<scenario>` on the NOC page; null = the real network. */
export function demoParam(search: string): string | null {
  const p = new URLSearchParams(search);
  if (!p.has('demo')) return null;
  return p.get('demo') || 'mixed';
}

/** Scenario list; a 404 means the api runs without DEMO_MODE (prod). */
export function useDemoList(enabled: boolean) {
  return useQuery({
    queryKey: ['demo-list'],
    queryFn: () => getOptional('/api/demo/scenarios', (v) => demoListSchema.parse(v)),
    enabled,
    retry: false,
  });
}

/** The scenario computed "now" by the api; refreshed so ages keep moving like live data. */
export function useDemo(name: string | null) {
  return useQuery<DemoData | null>({
    queryKey: ['demo', name],
    queryFn: () =>
      getOptional(`/api/demo/scenarios/${encodeURIComponent(name ?? '')}`, (v) =>
        demoScenarioSchema.parse(v),
      ),
    enabled: name !== null,
    refetchInterval: 30_000,
    retry: false,
  });
}

/** Demo labs not listed are full (scenario rule, M38); the snapshot only lists the exceptions. */
export function demoLabOnline(
  snap: StatusSnapshot,
  labs: { locCode: string; pcs: number | null }[],
): StatusSnapshot {
  const labOnline = { ...snap.labOnline };
  for (const l of labs)
    if (!(l.locCode in labOnline) && l.pcs !== null) labOnline[l.locCode] = l.pcs;
  return { ...snap, labOnline };
}
