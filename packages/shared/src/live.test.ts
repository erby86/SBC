import { describe, expect, it } from 'vitest';
import { applyDelta, diffSnapshots, isEmptyDelta, liveMessageSchema } from './live.js';
import { computeStatus } from './status.js';
import { DEMO_SCENARIOS, scenarioInput } from './demo/scenarios.js';
import { DEMO_TOPOLOGY } from './demo/topology.js';

const NOW = new Date('2026-10-05T03:00:00.000Z');
const snap = (name: string, now = NOW) => {
  const s = DEMO_SCENARIOS.find((x) => x.name === name);
  if (!s) throw new Error(name);
  return computeStatus(DEMO_TOPOLOGY, scenarioInput(s, now), now);
};

describe('live deltas (M16)', () => {
  it('rebuilds the next snapshot from the previous one plus the delta, both ways', () => {
    for (const [a, b] of [
      ['normal', 's8down'],
      ['s8down', 'mixed'],
      ['mixed', 'normal'],
      ['mixed', 'stale'],
    ] as const) {
      const prev = snap(a);
      const next = snap(b);
      const d = diffSnapshots(prev, next);
      expect(applyDelta(prev, d)).toEqual(next);
      expect(liveMessageSchema.parse({ type: 'delta', version: 2, delta: d }).type).toBe('delta');
    }
  });

  it('sends only devices whose state changed, ok for recovered ones', () => {
    const d = diffSnapshots(snap('s8down'), snap('normal'));
    expect(d.changed).toEqual({
      'm-s8': 'ok',
      'sw-s8-a': 'ok',
      'sw-s8-b': 'ok',
      fin: 'ok',
      'ap-s8-6-1': 'ok',
    });
  });

  it('recognises a poll that changed nothing but the clock', () => {
    const later = new Date(NOW.getTime() + 30_000);
    const prev = snap('mixed');
    expect(isEmptyDelta(prev, diffSnapshots(prev, snap('mixed', NOW)))).toBe(true);
    // sinces move with "now" in fixtures, so a later replay is a real change of incidents
    expect(isEmptyDelta(prev, diffSnapshots(prev, snap('mixed', later)))).toBe(false);
    expect(isEmptyDelta(prev, diffSnapshots(prev, snap('stale')))).toBe(false);
  });
});
