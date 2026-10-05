// M16: messages of the live status channel (WebSocket /status/ws). The first message is the whole
// snapshot; later ones carry only what changed, applied with applyDelta(). If a client misses a
// message (or its version does not follow), it asks for / waits for a full snapshot again.
import { z } from 'zod';
import {
  deviceStateSchema,
  incidentSchema,
  statusSnapshotSchema,
  type StatusSnapshot,
} from './status.js';

export const statusDeltaSchema = z.object({
  generatedAt: z.iso.datetime(),
  lastUpdate: z.iso.datetime(),
  stale: z.boolean(),
  /** Devices whose state changed; 'ok' means back to normal (removed from `states`). */
  changed: z.record(z.string(), deviceStateSchema),
  incidents: z.array(incidentSchema),
  counts: statusSnapshotSchema.shape.counts,
  labOnline: statusSnapshotSchema.shape.labOnline,
  maintenance: statusSnapshotSchema.shape.maintenance,
});
export type StatusDelta = z.infer<typeof statusDeltaSchema>;

export const liveMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'),
    version: z.number().int(),
    snapshot: statusSnapshotSchema,
  }),
  z.object({ type: z.literal('delta'), version: z.number().int(), delta: statusDeltaSchema }),
]);
export type LiveMessage = z.infer<typeof liveMessageSchema>;

export function diffSnapshots(prev: StatusSnapshot, next: StatusSnapshot): StatusDelta {
  const changed: StatusDelta['changed'] = {};
  for (const [code, st] of Object.entries(next.states))
    if (prev.states[code] !== st) changed[code] = st;
  for (const code of Object.keys(prev.states)) if (!(code in next.states)) changed[code] = 'ok';
  return {
    generatedAt: next.generatedAt,
    lastUpdate: next.lastUpdate,
    stale: next.stale,
    changed,
    incidents: next.incidents,
    counts: next.counts,
    labOnline: next.labOnline,
    maintenance: next.maintenance,
  };
}

export function applyDelta(prev: StatusSnapshot, d: StatusDelta): StatusSnapshot {
  const states = Object.fromEntries(
    Object.entries(prev.states).filter(([code]) => !(code in d.changed)),
  ) as StatusSnapshot['states'];
  for (const [code, st] of Object.entries(d.changed)) if (st !== 'ok') states[code] = st;
  return {
    generatedAt: d.generatedAt,
    lastUpdate: d.lastUpdate,
    stale: d.stale,
    states,
    incidents: d.incidents,
    counts: d.counts,
    labOnline: d.labOnline,
    maintenance: d.maintenance,
  };
}

/** Nothing worth sending: same states, incidents, counts and freshness. */
export function isEmptyDelta(prev: StatusSnapshot, d: StatusDelta): boolean {
  return (
    Object.keys(d.changed).length === 0 &&
    d.stale === prev.stale &&
    JSON.stringify(d.incidents) === JSON.stringify(prev.incidents) &&
    JSON.stringify(d.labOnline) === JSON.stringify(prev.labOnline) &&
    JSON.stringify(d.maintenance) === JSON.stringify(prev.maintenance)
  );
}
