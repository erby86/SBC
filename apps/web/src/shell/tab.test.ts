import { describe, expect, it } from 'vitest';
import type { StatusSnapshot } from '@sbc-noc/shared';
import { faviconSvg, tabState, tabTitle } from './tab.js';

const inc = (device: string, severity: 'down' | 'warn') => ({
  device,
  severity,
  since: '2026-10-05T04:00:00Z',
  message: 'x',
  impacted: 0,
  ack: null,
});
const snap = (incidents: ReturnType<typeof inc>[], stale = false) =>
  ({ stale, incidents }) as unknown as StatusSnapshot;

describe('tab status', () => {
  it('names the worst state first', () => {
    expect(tabState(null)).toBe('wait');
    expect(tabState(snap([]))).toBe('ok');
    expect(tabState(snap([inc('a', 'warn')]))).toBe('warn');
    expect(tabState(snap([inc('a', 'warn'), inc('b', 'down')]))).toBe('down');
    expect(tabState(snap([inc('b', 'down')], true))).toBe('stale');
  });

  it('puts counts in the title', () => {
    expect(tabTitle(snap([]), false)).toBe('ศูนย์ดูแลเครือข่าย · SB School');
    expect(tabTitle(snap([inc('a', 'warn'), inc('b', 'down'), inc('c', 'down')]), false)).toBe(
      '(2) ✕ ใช้งานไม่ได้ · ▲ 1 · ศูนย์ดูแลเครือข่าย',
    );
    expect(tabTitle(snap([inc('a', 'warn')]), true)).toBe(
      '[สาธิต] (1) ▲ ควรตรวจสอบ · ศูนย์ดูแลเครือข่าย',
    );
  });

  it('draws a badge with the count, capped at 9+', () => {
    expect(faviconSvg('wait', 0)).not.toContain('<circle cx="22.5"');
    expect(faviconSvg('down', 3)).toContain('>3</text>');
    expect(faviconSvg('warn', 12)).toContain('>9+</text>');
    expect(faviconSvg('stale', 2)).toContain('>!</text>');
  });
});
