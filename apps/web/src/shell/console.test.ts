import { describe, expect, it } from 'vitest';
import {
  firstToHandle,
  isLongStanding,
  logLines,
  ownCards,
  priority,
  rootGroup,
  shownState,
  splitIncidents,
  timelineBars,
  topCounts,
} from './console.js';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const inc = (
  device: string,
  severity: 'down' | 'warn',
  days: number,
  impacted = 0,
  ack: { by: string; note: string; at: string } | null = null,
  root: string | null = null,
) => ({ device, severity, since: daysAgo(days), message: 'x', impacted, ack, root });

describe('priority', () => {
  it('P1 down with impact, P2 down, P3 warn', () => {
    expect(priority(inc('a', 'down', 1, 3))).toBe('P1');
    expect(priority(inc('a', 'down', 1))).toBe('P2');
    expect(priority(inc('a', 'warn', 1, 2))).toBe('P3');
  });
});

describe('long-standing warnings', () => {
  it('only warnings older than 7 days fold', () => {
    expect(isLongStanding(inc('a', 'warn', 8), NOW)).toBe(true);
    expect(isLongStanding(inc('a', 'warn', 6.9), NOW)).toBe(false);
    expect(isLongStanding(inc('a', 'down', 149), NOW)).toBe(false);
  });

  it('splits in order', () => {
    const list = [inc('s8', 'down', 149, 3), inc('b1', 'warn', 147), inc('i1', 'warn', 2)];
    const { main, stale } = splitIncidents(list, NOW);
    expect(main.map((i) => i.device)).toEqual(['s8', 'i1']);
    expect(stale.map((i) => i.device)).toEqual(['b1']);
  });
});

describe('firstToHandle', () => {
  it('first down nobody has taken, else nothing', () => {
    const ack = { by: 'STF-01', note: '', at: daysAgo(0) };
    expect(firstToHandle([inc('a', 'down', 1, 0, ack), inc('b', 'down', 1)])?.device).toBe('b');
    expect(firstToHandle([inc('a', 'warn', 1)])).toBeNull();
  });
});

describe('timelineBars', () => {
  const h = (start: string, end: string | null, severity: 'down' | 'warn' = 'down') => ({
    device: 'd',
    host: 'd',
    severity,
    start,
    end,
    message: 'x',
  });

  it('clips to the window and counts events that started inside it', () => {
    const { bars, started } = timelineBars(
      {
        updatedAt: daysAgo(0),
        hours: 24,
        events: [
          h(
            new Date(NOW - 6 * 3_600_000).toISOString(),
            new Date(NOW - 3 * 3_600_000).toISOString(),
            'warn',
          ),
          h(daysAgo(149), null),
        ],
      },
      NOW,
    );
    expect(started).toBe(1);
    expect(bars[0]).toMatchObject({ severity: 'down', left: 0, width: 100, open: true });
    expect(bars[1]?.left).toBeCloseTo(75);
    expect(bars[1]?.width).toBeCloseTo(12.5);
  });

  it('skips events that ended before the window and handles no history', () => {
    expect(
      timelineBars({ updatedAt: daysAgo(0), hours: 24, events: [h(daysAgo(3), daysAgo(2))] }, NOW)
        .bars,
    ).toEqual([]);
    expect(timelineBars(null, NOW).bars).toEqual([]);
  });
});

describe('root-cause groups', () => {
  // core → c1036 → (m-i2 → sw-i2), (m-s8 → fin); mainA → mainB
  const devices = [
    { code: 'core', uplink: null, building: 'b2' },
    { code: 'c1036', uplink: 'core', building: 'b2' },
    { code: 'm-i2', uplink: 'c1036', building: 'i2' },
    { code: 'sw-i2', uplink: 'm-i2', building: 'i2' },
    { code: 'm-s8', uplink: 'c1036', building: 's8' },
    { code: 'fin', uplink: 'm-s8', building: 's8' },
    { code: 'sw-i2-b', uplink: 'm-i2', building: 'i2' },
    { code: 'mainA', uplink: 'core', building: 'ba' },
    { code: 'mainB', uplink: 'mainA', building: 'bb' },
  ];
  const incidents = [
    inc('c1036', 'down', 0.01, 6),
    inc('m-i2', 'down', 0.01, 2, null, 'c1036'),
    inc('m-s8', 'down', 0.01, 1, null, 'c1036'),
    inc('mainB', 'warn', 0.02),
  ];
  const states = {
    c1036: 'down',
    'm-i2': 'down',
    'm-s8': 'down',
    'sw-i2': 'cut',
    'sw-i2-b': 'cut',
    fin: 'cut',
    mainB: 'warn',
  } as const;

  it('followers have no card of their own and are never handled first', () => {
    expect(ownCards(incidents).map((i) => i.device)).toEqual(['c1036', 'mainB']);
    expect(firstToHandle([...incidents].reverse())?.device).toBe('c1036');
  });

  it('lists everything out behind the root cause, per building most first', () => {
    const g = rootGroup({ states }, devices, 'c1036');
    expect(g.dark).toEqual(['m-i2', 'sw-i2', 'm-s8', 'fin', 'sw-i2-b']);
    expect(g.buildings).toEqual([
      { code: 'i2', n: 3 },
      { code: 's8', n: 2 },
    ]);
  });

  it('top bar counts devices out, flags a single root cause, counts groups once', () => {
    const counts = { ok: 2, warn: 1, down: 3, cut: 3, maint: 0 };
    expect(topCounts({ counts, incidents, states })).toEqual({
      out: 6,
      roots: 1,
      oneRoot: true,
      warn: 1,
      open: 2,
    });
    // only devices of this screen count when the layout is known
    expect(topCounts({ counts, incidents, states }, (c) => c !== 'fin').out).toBe(5);
    const single = topCounts({
      counts: { ok: 8, warn: 0, down: 1, cut: 0, maint: 0 },
      incidents: [inc('ap', 'down', 0.01)],
      states: { ap: 'down' },
    });
    expect(single).toMatchObject({ out: 1, roots: 1, oneRoot: false });
  });

  it('draws a follower grey (cut), the root cause red', () => {
    const snap = { states, incidents };
    expect(shownState(snap, 'c1036')).toBe('down');
    expect(shownState(snap, 'm-i2')).toBe('cut');
    expect(shownState(snap, 'sw-i2')).toBe('cut');
    expect(shownState(snap, 'core')).toBe('ok');
    expect(shownState(null, 'core')).toBe('ok');
  });
});

describe('event log (syslog style)', () => {
  const at = (min: number) => new Date(NOW - min * 60_000).toISOString();
  const ev = (
    device: string,
    severity: 'down' | 'warn',
    start: number,
    end: number | null,
    message = 'ไม่ตอบ ping',
  ) => ({
    device,
    host: device,
    severity,
    start: at(start),
    end: end === null ? null : at(end),
    message,
  });
  const history = (events: ReturnType<typeof ev>[]) => ({ updatedAt: at(0), hours: 24, events });

  it('one line per start and per recovery, newest first, with how long it was out', () => {
    const lines = logLines(
      history([ev('wan1', 'down', 300, 294), ev('mainB', 'warn', 40, null)]),
      null,
    );
    expect(lines.map((l) => [l.level, l.host, l.at])).toEqual([
      ['warn', 'mainB', at(40)],
      ['ok', 'wan1', at(294)],
      ['down', 'wan1', at(300)],
    ]);
    expect(lines[1]).toMatchObject({ outMin: 6, was: 'down' });
  });

  it('folds the followers of a root cause into one "+N" line', () => {
    const snap = {
      stale: false,
      lastUpdate: at(0),
      incidents: [
        inc('c1036', 'down', 0.01, 21),
        inc('m-i2', 'down', 0.01, 7, null, 'c1036'),
        inc('m-s8', 'down', 0.01, 3, null, 'c1036'),
      ],
    };
    const lines = logLines(
      history([
        ev('c1036', 'down', 6, null),
        ev('m-i2', 'down', 5, null),
        ev('m-s8', 'down', 4, null),
      ]),
      snap,
    );
    expect(lines.map((l) => [l.level, l.host, l.followers ?? 0, l.root ?? null])).toEqual([
      ['down', '+2 ตัว', 2, 'c1036'],
      ['down', 'c1036', 0, null],
    ]);
    expect(lines[0]?.at).toBe(at(4));
    expect(lines[0]?.device).toBe('c1036');
  });

  it('puts a system line on top when the data is not fresh', () => {
    const lines = logLines(history([ev('mainB', 'warn', 40, null)]), {
      stale: true,
      lastUpdate: at(6),
      incidents: [],
    });
    expect(lines[0]).toMatchObject({ level: 'sys', host: 'worker', at: at(6) });
  });
});
