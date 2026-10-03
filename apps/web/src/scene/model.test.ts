import type { Device, Layout } from '@sbc-noc/shared';
import { describe, expect, it } from 'vitest';
import {
  buildSceneModel,
  crosses,
  deviceKind,
  FIBER_FALLBACK,
  isComputerLab,
  type Vec3,
} from './model.js';

const building = (
  code: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  floors: number,
  extra: Record<string, unknown> = {},
): Layout['buildings'][number] => ({
  code,
  name: `อาคาร ${code}`,
  nameEn: null,
  aliases: [],
  assetName: null,
  form: null,
  floorCount: floors,
  roomsPerFloor: null,
  hasNetwork: true,
  shape: { x, z, width, depth, rotation: 0, floorHeight: 0.9, extra },
});

const device = (code: string, over: Partial<Device>): Device => ({
  code,
  name: code,
  hostname: null,
  role: 'access',
  layer: 'net',
  model: null,
  ip: null,
  mac: null,
  building: null,
  floor: null,
  locCode: null,
  uplink: null,
  uplinkMedia: null,
  managedBy: null,
  lifecycle: 'active',
  dataStatus: 'unverified',
  zabbixHostId: null,
  placement: null,
  ...over,
});

const link = (a: string, b: string, media: string, color: string | null = null) => ({
  code: null,
  a,
  b,
  media,
  isUplink: true,
  cable: null,
  cableCores: null,
  speedMbps: null,
  color,
  lane: null,
  waypoints: [] as [number, number][],
});

// b2 (server room) south, b1 in the middle, i1 (ring) north: like the school, without rotation
const layout: Layout = {
  site: { code: 'sbc', name: 'SB School', timezone: 'Asia/Bangkok' },
  buildings: [
    building('b2', 0, 10, 24, 3, 3),
    building('b1', 0, 0, 24, 3, 3),
    building('i1', 0, -15, 19, 11.8, 3, { ring: [10, 5.8] }),
  ],
  areas: [],
  locations: [
    {
      locCode: 'LOC-031',
      building: 'b2',
      floor: 3,
      name: 'ห้องคอม 2310',
      roomNumber: null,
      type: null,
      corridorOrder: null,
      side: null,
      hasRack: false,
      owner: 'asset',
      verifiedAt: null,
      registryPcCount: 40,
    },
    {
      locCode: 'LOC-001',
      building: 'b1',
      floor: 1,
      name: 'ห้องครู',
      roomNumber: null,
      type: 'classroom',
      corridorOrder: null,
      side: null,
      hasRack: false,
      owner: 'asset',
      verifiedAt: null,
      registryPcCount: 3,
    },
  ],
  devices: [
    device('c1036', { role: 'core', building: 'b2', floor: 1 }),
    device('m-i1', { role: 'main', building: 'i1', floor: 1, uplink: 'c1036' }),
    device('sw-b2-2', { building: 'b2', floor: 2, uplink: 'c1036' }),
    ...[1, 2, 3, 4].map((i) =>
      device(`ap-b2-${i}`, {
        name: `AP อาคาร 2 #${i}`,
        role: 'ap',
        layer: 'ap',
        building: 'b2',
        floor: 2,
        uplink: 'sw-b2-2',
      }),
    ),
    device('ap-i1', { role: 'ap', layer: 'ap', building: 'i1', floor: 2, uplink: 'm-i1' }),
    device('nvr-b1', { role: 'nvr', layer: 'nvr', building: 'b1', floor: 1 }),
    device('wan0', { name: 'NT', role: 'wan', layer: 'wan', uplink: 'c1036' }),
    device('wan1', { name: '3BB', role: 'wan', layer: 'wan', uplink: 'c1036' }),
    device('fixed', {
      building: 'b1',
      floor: 2,
      placement: { mode: 'manual', u: 0.4, v: 0.25, heightOffset: 0.1 },
    }),
    device('nowhere', { role: 'access' }),
    device('ups-1', { role: 'ups', layer: 'power', building: 'b2', floor: 1 }),
  ],
  links: [
    link('c1036', 'm-i1', 'fiber', '#8b6bff'),
    link('c1036', 'sw-b2-2', 'copper'),
    ...[1, 2, 3, 4].map((i) => link('sw-b2-2', `ap-b2-${i}`, 'copper')),
    link('c1036', 'wan0', 'pppoe'),
    link('c1036', 'wan1', 'pppoe'),
    link('c1036', 'nowhere', 'copper'),
    link('c1036', 'fixed', 'fiber'),
  ],
  cables: [],
};

const model = buildSceneModel(layout);
const dev = (code: string) => {
  const d = model.devices.find((x) => x.code === code);
  if (!d) throw new Error(`no ${code}`);
  return d;
};

describe('deviceKind', () => {
  it('maps registry roles to the prototype shapes and skips what the map does not show', () => {
    expect(deviceKind({ role: 'core', layer: 'net', lifecycle: 'active' })).toBe('core');
    expect(deviceKind({ role: 'fiber_point', layer: 'net', lifecycle: 'active' })).toBe('main');
    expect(deviceKind({ role: 'finance_router', layer: 'net', lifecycle: 'active' })).toBe(
      'access',
    );
    expect(deviceKind({ role: 'controller', layer: 'planned', lifecycle: 'active' })).toBe(
      'planned',
    );
    expect(deviceKind({ role: 'ups', layer: 'power', lifecycle: 'active' })).toBeNull();
  });
});

describe('buildSceneModel — placement', () => {
  it('spreads the APs of a floor along the building under the ceiling', () => {
    const aps = [1, 2, 3, 4].map((i) => dev(`ap-b2-${i}`));
    const xs = aps.map((a) => a.pos.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs.map((x) => x.toFixed(2))).size).toBe(4);
    for (const a of aps) {
      expect(a.pos.z).toBeCloseTo(10); // centre line of b2
      expect(a.pos.y).toBeCloseTo(0.9 + 0.9 - 0.15); // floor 2 ceiling
      expect(a.layer).toBe('ap');
    }
  });

  it('keeps devices of a ring building on its outer band, not in the courtyard', () => {
    const ap = dev('ap-i1');
    expect(Math.abs(ap.pos.z - -15)).toBeGreaterThan(5.8 / 2);
    expect(Math.abs(ap.pos.z - -15)).toBeLessThan(11.8 / 2);
  });

  it('uses a manual placement as it is', () => {
    const f = dev('fixed');
    expect(f.pos.x).toBeCloseTo(0.4 * 24);
    expect(f.pos.z).toBeCloseTo(0.25 * 3);
    expect(f.pos.y).toBeCloseTo(0.9 + 0.4 + 0.1);
  });

  it('lines the ISPs up high above the gateway', () => {
    const [a, b] = [dev('wan0'), dev('wan1')];
    expect(a.pos.y).toBe(15);
    expect(b.pos.x - a.pos.x).toBeCloseTo(6.5);
    expect((a.pos.x + b.pos.x) / 2).toBeCloseTo(dev('c1036').pos.x);
  });

  it('lists devices without a building as unplaced and skips UPS', () => {
    expect(model.unplaced).toEqual(['nowhere']);
    expect(model.devices.some((d) => d.code === 'ups-1')).toBe(false);
  });

  it('draws computer labs from SBC ASSET rooms named or typed as labs', () => {
    expect(isComputerLab({ type: 'computer_lab', name: 'C220' })).toBe(true);
    expect(isComputerLab({ type: null, name: 'ห้องเปล่าแต่มีคอม' })).toBe(false);
    expect(model.labs.map((l) => l.locCode)).toEqual(['LOC-031']);
    expect(model.labs[0]).toMatchObject({ building: 'b2', floor: 3, pcs: 40 });
  });
});

describe('buildSceneModel — cable runs', () => {
  const run = (b: string) => {
    const l = model.links.find((x) => x.b === b);
    if (!l) throw new Error(`no link to ${b}`);
    return l;
  };
  const segs = (pts: Vec3[]) => pts.slice(0, -1).map((p, i) => [p, pts[i + 1] as Vec3] as const);

  it('routes a fibre around the building in between, with right angles only', () => {
    const f = run('m-i1');
    expect(f.kind).toBe('fiber');
    expect(f.color).toBe('#8b6bff');
    const b1 = model.buildings.find((b) => b.code === 'b1');
    if (!b1) throw new Error('no b1');
    for (const [p, q] of segs(f.points.slice(1, -1))) {
      expect(crosses(b1, p, q)).toBe(false);
      const axis = [p.x !== q.x, p.y !== q.y, p.z !== q.z].filter(Boolean).length;
      expect(axis).toBeLessThanOrEqual(1);
    }
    expect(f.points[0]).toEqual(dev('c1036').pos);
    expect(f.points[f.points.length - 1]).toEqual(dev('m-i1').pos);
  });

  it('gives fibres without a colour one from the prototype set', () => {
    expect(run('fixed').color).toBe(FIBER_FALLBACK[0]);
  });

  it('draws links inside one building and AP links straight', () => {
    expect(run('sw-b2-2').points).toHaveLength(2);
    expect(run('ap-b2-1')).toMatchObject({ kind: 'ap', layer: 'ap' });
    expect(run('ap-b2-1').points).toHaveLength(2);
  });

  it('goes up to the ISP globes and skips links to unplaced devices', () => {
    expect(run('wan0').kind).toBe('wan');
    expect(run('wan0').points.length).toBeGreaterThan(2);
    expect(model.links.some((l) => l.b === 'nowhere')).toBe(false);
  });

  it('follows hand-drawn waypoints when the registry has them', () => {
    const m = buildSceneModel({
      ...layout,
      links: [{ ...link('c1036', 'm-i1', 'fiber'), lane: 2, waypoints: [[30, 10]] }],
    });
    const pts = m.links[0]?.points ?? [];
    expect(pts.some((p) => p.x === 30 && p.z === 10)).toBe(true);
  });
});

describe('crosses', () => {
  const box = { x: 0, z: 0, width: 4, depth: 2, rotation: 0 };
  it('detects a segment through a building and ignores one beside it', () => {
    expect(crosses(box, { x: -5, z: 0 }, { x: 5, z: 0 })).toBe(true);
    expect(crosses(box, { x: -5, z: 2 }, { x: 5, z: 2 })).toBe(false);
    expect(crosses({ ...box, rotation: Math.PI / 2 }, { x: -1.5, z: -5 }, { x: -1.5, z: 5 })).toBe(
      false,
    );
  });
});
