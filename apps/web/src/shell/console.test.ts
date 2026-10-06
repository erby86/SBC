import { describe, expect, it } from 'vitest';
import {
  firstToHandle,
  isLongStanding,
  priority,
  splitIncidents,
  timelineBars,
} from './console.js';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const inc = (
  device: string,
  severity: 'down' | 'warn',
  days: number,
  impacted = 0,
  ack: { by: string; note: string; at: string } | null = null,
) => ({ device, severity, since: daysAgo(days), message: 'x', impacted, ack });

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
