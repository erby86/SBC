import { describe, expect, it } from 'vitest';
import { diffIncidents } from './events.js';

const inc = (device: string, severity: 'down' | 'warn') => ({
  device,
  severity,
  since: '2026-10-05T04:00:00Z',
  message: 'x',
  impacted: 0,
  ack: null,
});

describe('diffIncidents', () => {
  it('reports nothing for the first snapshot', () => {
    expect(diffIncidents(null, [inc('a', 'down')])).toEqual([]);
  });

  it('reports new, worse and recovered, worst first', () => {
    const ev = diffIncidents(
      [inc('a', 'warn'), inc('gone', 'warn'), inc('same', 'down')],
      [inc('same', 'down'), inc('n', 'warn'), inc('a', 'down')],
      1,
    );
    expect(ev.map((e) => [e.change, e.kind, e.device])).toEqual([
      ['worse', 'down', 'a'],
      ['new', 'warn', 'n'],
      ['ok', 'ok', 'gone'],
    ]);
  });

  it('ignores a device that got better (down → warn) or stayed the same', () => {
    expect(diffIncidents([inc('a', 'down')], [inc('a', 'warn')])).toEqual([]);
  });
});
