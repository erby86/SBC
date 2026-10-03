// M15 through the M38 fixtures: each prototype scenario is played as Zabbix data (problems,
// acknowledges, maintenance) and must give the same result as the fixture itself.
import {
  computeStatus,
  DEMO_SCENARIOS,
  DEMO_TOPOLOGY,
  scenarioInput,
  type DemoScenario,
} from '@sbc-noc/shared';
import { describe, expect, it } from 'vitest';
import type { ZabbixProblem } from '../connectors/zabbix.js';
import {
  createStatusEngine,
  inputFromZabbix,
  SNAPSHOT_KEY,
  stateOfSeverity,
  UPDATES_CHANNEL,
} from './engine.js';

const NOW = new Date('2026-10-05T03:00:00.000Z');
const host = (device: string) => `h-${device}`;
const deviceOfHost = new Map(DEMO_TOPOLOGY.map((d) => [host(d.code), d.code]));
const sec = (d: Date, minAgo: number) => Math.floor(d.getTime() / 1000) - minAgo * 60;

/** A scenario as Zabbix would report it at `now`. */
function asZabbix(s: DemoScenario, now: Date) {
  const problems: ZabbixProblem[] = s.signals.map((x, i) => {
    const ack = s.acks.find((a) => a.device === x.device);
    return {
      eventid: String(i + 1),
      name: x.message,
      severity: x.severity === 'down' ? 4 : 2,
      clock: sec(now, x.sinceMin),
      hostids: [host(x.device)],
      acknowledged: Boolean(ack),
      ack: ack ? { userid: ack.by, clock: sec(now, ack.atMin), message: ack.note } : null,
    };
  });
  const maintenance = s.maintenance.map((m) => ({ hostid: host(m.device), name: m.message }));
  return { problems, maintenance };
}

const summary = (snap: ReturnType<typeof computeStatus>) => ({
  states: snap.states,
  counts: snap.counts,
  stale: snap.stale,
  incidents: snap.incidents.map((i) => [
    i.device,
    i.severity,
    i.since,
    i.impacted,
    i.ack?.note ?? null,
  ]),
});

describe('status engine on the M38 scenarios', () => {
  for (const s of DEMO_SCENARIOS.filter((x) => x.name !== 'stale')) {
    it(`${s.name}: Zabbix data gives the fixture result`, () => {
      const z = asZabbix(s, NOW);
      const input = inputFromZabbix(z.problems, z.maintenance, deviceOfHost, NOW);
      const expected = computeStatus(
        DEMO_TOPOLOGY,
        { ...scenarioInput(s, NOW), labOnline: {} },
        NOW,
      );
      expect(summary(computeStatus(DEMO_TOPOLOGY, input, NOW))).toEqual(summary(expected));
    });
  }

  it('stale: Zabbix unreadable for 6 minutes keeps the last data and marks it stale', async () => {
    const mixed = DEMO_SCENARIOS.find((x) => x.name === 'mixed') as DemoScenario;
    const start = new Date(NOW.getTime() - 6 * 60_000);
    const z = asZabbix(mixed, start);
    let up = true;
    const writes: [string, string][] = [];
    const engine = createStatusEngine({
      db: null,
      topology: async () => ({ topology: DEMO_TOPOLOGY, deviceOfHost }),
      zabbix: {
        problems: async () => (up ? z.problems : Promise.reject(new Error('ECONNREFUSED'))),
        hostsInMaintenance: async () =>
          up ? z.maintenance : Promise.reject(new Error('ECONNREFUSED')),
      },
      store: {
        set: async (k, v) => writes.push([k, v]),
        publish: async (c, v) => writes.push([c, v]),
      },
      logger: { warn: () => undefined },
    });
    expect((await engine.tick(start))?.stale).toBe(false);
    up = false;
    expect((await engine.tick(new Date(start.getTime() + 60_000)))?.stale).toBe(false);
    const late = await engine.tick(NOW);
    expect(late?.stale).toBe(true);
    expect(late?.lastUpdate).toBe(start.toISOString());
    expect(summary(late as never).states).toEqual(
      computeStatus(DEMO_TOPOLOGY, scenarioInput(mixed, NOW), NOW).states,
    );
    expect(writes.filter(([k]) => k === SNAPSHOT_KEY)).toHaveLength(3);
    expect(writes.filter(([k]) => k === UPDATES_CHANNEL)).toHaveLength(3);
  });
});

describe('Zabbix → engine input', () => {
  const p = (over: Partial<ZabbixProblem>): ZabbixProblem => ({
    eventid: '1',
    name: 'Unavailable by ICMP ping',
    severity: 4,
    clock: 1000,
    hostids: ['10085'],
    acknowledged: false,
    ack: null,
    ...over,
  });
  const map = new Map([['10085', 'c1036']]);

  it('maps severities: High/Disaster down, Warning/Average warn, lower ignored', () => {
    expect([0, 1, 2, 3, 4, 5].map(stateOfSeverity)).toEqual([
      null,
      null,
      'warn',
      'warn',
      'down',
      'down',
    ]);
  });

  it('keeps the worst and oldest problem per device and counts the rest', () => {
    const input = inputFromZabbix(
      [
        p({ eventid: '1', severity: 2, clock: 900, name: 'High latency' }),
        p({ eventid: '2', severity: 4, clock: 1200, name: 'Unavailable by ICMP ping' }),
        p({ eventid: '3', severity: 5, clock: 1100, name: 'Interface down' }),
        p({ eventid: '4', severity: 1, clock: 800, name: 'info only' }),
      ],
      [],
      map,
      NOW,
    );
    expect(input.signals).toEqual([
      {
        device: 'c1036',
        severity: 'down',
        since: new Date(1100 * 1000).toISOString(),
        message: 'Interface down (+2 ปัญหา)',
      },
    ]);
  });

  it('skips hosts outside the registry and maps acknowledges and maintenance', () => {
    const input = inputFromZabbix(
      [
        p({ hostids: ['99999'] }),
        p({ acknowledged: true, ack: { userid: '7', clock: 1500, message: 'กำลังไปดู' } }),
      ],
      [
        { hostid: '10085', name: 'เปลี่ยนสาย' },
        { hostid: '99999', name: 'x' },
      ],
      map,
      NOW,
    );
    expect(input.signals.map((s) => s.device)).toEqual(['c1036']);
    expect(input.acks).toEqual([
      {
        device: 'c1036',
        by: 'zabbix:7',
        note: 'กำลังไปดู',
        at: new Date(1500 * 1000).toISOString(),
      },
    ]);
    expect(input.maintenance).toEqual([{ device: 'c1036', message: 'เปลี่ยนสาย', by: 'Zabbix' }]);
  });
});
