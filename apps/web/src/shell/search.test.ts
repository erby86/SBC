import type { Layout } from '@sbc-noc/shared';
import { describe, expect, it } from 'vitest';
import { buildIndex, norm, runSearch, stateGetter, type SearchEntry } from './search.js';

const building = (code: string, name: string, floorCount: number) => ({
  code,
  name,
  nameEn: null,
  aliases: [],
  assetName: null,
  form: null,
  floorCount,
  roomsPerFloor: null,
  hasNetwork: true,
  shape: null,
});
const device = (
  code: string,
  name: string,
  role: string,
  b: string | null,
  floor: number | null,
  ip: string | null = null,
) => ({
  code,
  name,
  hostname: null,
  role,
  layer: role === 'ap' ? 'ap' : role === 'nvr' ? 'nvr' : role === 'wan' ? 'wan' : 'net',
  model: null,
  ip,
  mac: null,
  building: b,
  floor,
  locCode: null,
  uplink: null,
  uplinkMedia: null,
  managedBy: null,
  lifecycle: 'active',
  dataStatus: 'unverified',
  zabbixHostId: null,
  placement: null,
});

const layout: Layout = {
  site: { code: 'sbc', name: 'SB School', timezone: 'Asia/Bangkok' },
  buildings: [
    building('s8', '8 เซียน', 8),
    building('i1', 'ICET1', 3),
    building('bb', 'อาคาร B', 7),
  ],
  areas: [],
  locations: [
    {
      locCode: 'LOC-050',
      building: 's8',
      floor: 6,
      name: 'ห้องคอม',
      roomNumber: '603',
      type: null,
      corridorOrder: null,
      side: null,
      hasRack: false,
      owner: 'sbc_asset',
      verifiedAt: null,
      registryPcCount: 40,
    },
  ],
  devices: [
    device('m-s8', '8 เซียน main', 'main', 's8', 3, '192.168.1.80'),
    device('ap-s8-6-1', 'AP 8 เซียน 6-1', 'ap', 's8', 6),
    device('ap-s8-5-1', 'AP 8 เซียน 5-1', 'ap', 's8', 5),
    device('nvr-i1-1', 'NVR ICET1 #1', 'nvr', 'i1', 1, '192.168.104.11'),
    device('sw-bb-6', 'สวิตช์ อาคาร B ชั้น 6', 'access', 'bb', 6),
    device('wan1', '3BB', 'wan', null, null),
  ],
  links: [],
  cables: [],
};
const index = buildIndex(layout);
const ok = stateGetter(null);
const ids = (r: SearchEntry[]) => r.map((e) => `${e.kind}:${e.id}`);

describe('search (M20)', () => {
  it('normalises spaces, punctuation and ฯ', () => {
    expect(norm('ห้องคอมฯ  8-เซียน (ชั้น 6)')).toBe('ห้องคอม8เซียนชั้น6');
  });

  it('matches several words: type + building nickname + floor', () => {
    expect(ids(runSearch(index, 'ap 8 เซียน 6', ok))).toEqual(['d:ap-s8-6-1']);
    expect(ids(runSearch(index, 'กล้อง icet1', ok))).toEqual(['d:nvr-i1-1']);
    expect(ids(runSearch(index, 'แปดเซียน', ok))[0]).toBe('b:s8');
  });

  it('"b" alone means อาคาร B, and a number is a floor or part of a building name', () => {
    expect(ids(runSearch(index, 'b 6', ok))).toEqual(['f:bb#6', 'd:sw-bb-6']);
    expect(runSearch(index, '8', ok).some((e) => e.id === 's8')).toBe(true);
  });

  it('finds an IP by prefix, ranks the exact IP first', () => {
    expect(ids(runSearch(index, '192.168.1.80', ok))).toEqual(['d:m-s8']);
    expect(runSearch(index, '192.168.104', ok).map((e) => e.id)).toEqual(['nvr-i1-1']);
  });

  it('finds rooms by LOC code and labs by "ห้องคอม"', () => {
    expect(ids(runSearch(index, 'loc-050', ok))).toEqual(['r:LOC-050']);
    const lab = runSearch(index, 'ห้องคอม', ok)[0];
    expect(lab).toMatchObject({ kind: 'r', lab: true, building: 's8', floor: 6 });
  });

  it('status words use the live states', () => {
    const st = stateGetter({
      generatedAt: '2026-10-05T03:00:00.000Z',
      lastUpdate: '2026-10-05T03:00:00.000Z',
      stale: false,
      states: { 'ap-s8-6-1': 'down', 'sw-bb-6': 'maint' },
      incidents: [],
      counts: { ok: 0, warn: 0, down: 1, cut: 0, maint: 1 },
      labOnline: {},
      maintenance: [],
    });
    expect(ids(runSearch(index, 'ap ล่ม', st))).toEqual(['d:ap-s8-6-1']);
    expect(ids(runSearch(index, 'บำรุง', st))).toEqual(['d:sw-bb-6']);
  });

  it('ISPs are found as internet', () => {
    expect(runSearch(index, 'เน็ต', ok).map((e) => e.label)).toEqual(['อินเทอร์เน็ต 3BB']);
  });

  it('groups buildings, floors, rooms, devices in that order', () => {
    const kinds = runSearch(index, '8 เซียน', ok).map((e) => e.kind);
    expect(kinds.indexOf('b')).toBeLessThan(kinds.indexOf('f'));
    expect(kinds.indexOf('f')).toBeLessThan(kinds.indexOf('d'));
  });
});
