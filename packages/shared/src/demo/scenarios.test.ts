// M38: the four prototype scenarios with their expected results. M15 runs its engine through the
// same fixtures; any change of the status rules must keep these results (or change them on purpose).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeStatus, statusSnapshotSchema } from '../status.js';
import { DEMO_SCENARIOS, findScenario, scenarioInput } from './scenarios.js';
import { DEMO_TOPOLOGY } from './topology.js';

const NOW = new Date('2026-10-05T03:00:00.000Z'); // 10:00 Bangkok
const run = (name: string) => {
  const s = findScenario(name);
  if (!s) throw new Error(name);
  return statusSnapshotSchema.parse(computeStatus(DEMO_TOPOLOGY, scenarioInput(s, NOW), NOW));
};
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

describe('demo scenarios (prototype → fixtures)', () => {
  it('mixed: two down (one acknowledged), two warnings, one switch in maintenance', () => {
    const r = run('mixed');
    expect(r.states).toEqual({
      'ap-s8-6-1': 'down',
      'nvr-i1-1': 'down',
      'm-a1': 'warn',
      wan1: 'warn',
      'sw-bb-6': 'maint',
    });
    expect(r.incidents.map((i) => [i.device, i.severity, i.impacted, i.ack?.by ?? null])).toEqual([
      ['ap-s8-6-1', 'down', 0, null],
      ['nvr-i1-1', 'down', 0, 'STF-03'],
      ['wan1', 'warn', 0, null],
      ['m-a1', 'warn', 0, null],
    ]);
    expect(r.incidents[0]?.since).toBe(minAgo(12));
    expect(r.counts).toEqual({ ok: 46, warn: 2, down: 2, cut: 0, maint: 1 });
    expect(r.stale).toBe(false);
    expect(r.labOnline).toEqual({ 'LOC-050': 31, 'LOC-158': 24 });
  });

  it('s8down: one root cause, everything below it is cut off, labs on floors 5–6 offline', () => {
    const r = run('s8down');
    expect(r.states).toEqual({
      'm-s8': 'down',
      'sw-s8-a': 'cut',
      'sw-s8-b': 'cut',
      fin: 'cut',
      'ap-s8-6-1': 'cut',
    });
    expect(r.incidents).toEqual([
      {
        device: 'm-s8',
        severity: 'down',
        since: minAgo(3),
        message: 'ไม่ตอบ ping · ไฟเบอร์จากอาคาร 2',
        impacted: 4,
        ack: null,
      },
    ]);
    expect(r.counts).toMatchObject({ down: 1, cut: 4, ok: 46 });
    expect(r.labOnline).toMatchObject({ 'LOC-045': 0, 'LOC-049': 0, 'LOC-050': 0 });
  });

  it('stale: same events as mixed but data is 6 minutes old', () => {
    const r = run('stale');
    expect(r.stale).toBe(true);
    expect(r.lastUpdate).toBe(minAgo(6));
    expect(r.states).toEqual(run('mixed').states);
  });

  it('normal: everything ok', () => {
    const r = run('normal');
    expect(r).toMatchObject({ states: {}, incidents: [], stale: false, labOnline: {} });
    expect(r.counts.ok).toBe(DEMO_TOPOLOGY.length);
  });

  it('only uses devices of the demo topology, which follows the seed registry', () => {
    const codes = new Set(DEMO_TOPOLOGY.map((d) => d.code));
    for (const s of DEMO_SCENARIOS) {
      for (const x of [...s.signals, ...s.acks, ...s.maintenance, ...s.history]) {
        expect(codes, `${s.name}: ${x.device}`).toContain(x.device);
      }
    }
    const seed = readFileSync(
      new URL('../../../../infra/seed/devices.csv', import.meta.url),
      'utf8',
    )
      .split('\n')
      .slice(1)
      .filter((l) => l && !l.includes(',ตัวอย่าง,'))
      .map((l) => l.split(',')[0]);
    expect([...codes].filter((c) => !c.startsWith('ap-')).sort()).toEqual([...seed].sort());
    for (const d of DEMO_TOPOLOGY) if (d.uplink) expect(codes).toContain(d.uplink);
  });
});

describe('status rules', () => {
  const topo = [
    { code: 'core', name: 'core', role: 'core', uplink: null },
    { code: 'main', name: 'main', role: 'main', uplink: 'core' },
    { code: 'sw', name: 'sw', role: 'access', uplink: 'main' },
    { code: 'ap', name: 'ap', role: 'ap', uplink: 'sw' },
  ];
  const input = (over: Partial<Parameters<typeof computeStatus>[1]> = {}) => ({
    lastUpdate: NOW.toISOString(),
    signals: [],
    acks: [],
    maintenance: [],
    labOnline: {},
    ...over,
  });
  const down = (device: string, sinceMin = 1) => ({
    device,
    severity: 'down' as const,
    since: minAgo(sinceMin),
    message: 'x',
  });

  it('maintenance covers the device and everything below, and hides their alarms', () => {
    const r = computeStatus(
      topo,
      input({
        maintenance: [{ device: 'main', message: 'm', by: 'STF-01' }],
        signals: [down('sw')],
      }),
      NOW,
    );
    expect(r.states).toEqual({ main: 'maint', sw: 'maint', ap: 'maint' });
    expect(r.incidents).toEqual([]);
  });

  it('a device that is down itself below a root cause stays down and is its own incident', () => {
    const r = computeStatus(topo, input({ signals: [down('main', 5), down('ap', 2)] }), NOW);
    expect(r.states).toEqual({ main: 'down', sw: 'cut', ap: 'down' });
    expect(r.incidents.map((i) => [i.device, i.impacted])).toEqual([
      ['main', 2],
      ['ap', 0],
    ]);
  });

  it('a warning below a down device shows as cut, not warn', () => {
    const r = computeStatus(
      topo,
      input({
        signals: [down('main'), { device: 'sw', severity: 'warn', since: minAgo(1), message: 'w' }],
      }),
      NOW,
    );
    expect(r.states['sw']).toBe('cut');
    expect(r.incidents.map((i) => i.device)).toEqual(['main']);
  });

  it('ignores devices outside the topology and survives uplink loops', () => {
    const loop = [
      { code: 'a', name: 'a', role: 'x', uplink: 'b' },
      { code: 'b', name: 'b', role: 'x', uplink: 'a' },
    ];
    const r = computeStatus(loop, input({ signals: [down('a'), down('ghost')] }), NOW);
    expect(r.states).toEqual({ a: 'down', b: 'cut' });
    expect(r.incidents.map((i) => i.device)).toEqual(['a']);
  });

  it('is stale only after more than 2 minutes without data', () => {
    expect(computeStatus(topo, input({ lastUpdate: minAgo(2) }), NOW).stale).toBe(false);
    expect(computeStatus(topo, input({ lastUpdate: minAgo(2.01) }), NOW).stale).toBe(true);
  });
});
