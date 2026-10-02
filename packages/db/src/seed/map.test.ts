import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.js';
import { deviceStatus, fiberCode, mediaCode, modelOf, parseVlans } from './map.js';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes and CRLF', () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n\r\n1,\n');
    expect(rows).toEqual([
      { a: 'x, y', b: 'say "hi"' },
      { a: '1', b: '' },
    ]);
  });
});

describe('seed mapping', () => {
  it('parses VLAN cells', () => {
    expect(parseVlans('60')).toEqual([{ vid: 60, name: null, planned: false }]);
    expect(parseVlans('103 / 104').map((v) => v.vid)).toEqual([103, 104]);
    expect(parseVlans('98 (วางแผน)')).toEqual([{ vid: 98, name: null, planned: true }]);
    expect(parseVlans('100 (Admin + Academic)')).toEqual([
      { vid: 100, name: 'Admin + Academic', planned: false },
    ]);
    expect(parseVlans('')).toEqual([]);
  });

  it('maps link types and rejects unknown ones', () => {
    expect(mediaCode('ไฟเบอร์')).toBe('fiber');
    expect(mediaCode('LACP 4x1G')).toBe('lacp');
    expect(() => mediaCode('wifi')).toThrow('unknown link type');
  });

  it('builds fiber labels per ADR-0006', () => {
    expect(fiberCode('b2', 'ba', 1)).toBe('FO-B2-BA-01');
  });

  it('keeps sample rows out of the active registry', () => {
    expect(deviceStatus('ตัวอย่าง')).toEqual({ lifecycle: 'planned', dataStatus: 'sample' });
    expect(deviceStatus('ต้องตรวจ')).toEqual({ lifecycle: 'active', dataStatus: 'unverified' });
  });

  it('skips descriptive model placeholders', () => {
    expect(modelOf('สวิตช์ประจำชั้น')).toBeNull();
    expect(modelOf('MikroTik CCR2116-12G-4S+')).toEqual({
      name: 'MikroTik CCR2116-12G-4S+',
      kind: 'router',
    });
    expect(modelOf('Hikvision NVR')?.kind).toBe('nvr');
  });
});
