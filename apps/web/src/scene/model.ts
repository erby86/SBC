// M19: turns the registry layout (M14, /api/registry/layout) into what the 3D scene draws —
// world positions of devices, lab rooms and cable runs. Pure functions without three.js so the
// rules are testable in node; NocScene.ts only turns this model into meshes.
//
// Coordinates follow the prototype (docs/prototype/sb-noc-3d-baseline-v3.html): metres / 10,
// x east, z south, y up; a building is a rotated box (shape x, z, width, depth, rotation) and
// a point inside it is (u, v) in -0.5..0.5 of its width/depth.
import type { Device, Layout, Link } from '@sbc-noc/shared';
import type { LayerKey } from '@sbc-noc/ui';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Shapes of devices, like the prototype: core box, main octahedron, AP disc … */
export type DeviceKind = 'core' | 'main' | 'access' | 'ap' | 'nvr' | 'wan' | 'planned';

export interface BuildingModel {
  code: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
  floors: number;
  floorHeight: number;
  /** Inner courtyard [width, depth] (ICET1). */
  ring: [number, number] | null;
}

export interface AreaModel {
  code: string;
  name: string;
  kind: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
}

export interface DeviceModel {
  code: string;
  name: string;
  kind: DeviceKind;
  layer: LayerKey;
  building: string | null;
  floor: number | null;
  pos: Vec3;
  rotY: number;
  device: Device;
}

export interface LabModel {
  locCode: string;
  name: string;
  building: string;
  floor: number;
  pcs: number | null;
  pos: Vec3;
  rotY: number;
}

export type LinkKind = 'fiber' | 'core' | 'copper' | 'riser' | 'wan' | 'ap' | 'planned';

export interface LinkModel {
  key: string;
  /** Upstream device (a) and the device it feeds (b): the status of b colours the link. */
  a: string;
  b: string;
  kind: LinkKind;
  layer: LayerKey;
  /** Fibre colour (registry or fallback); null for other kinds. */
  color: string | null;
  /** Registry cable of a fibre and its route note, for the legend. */
  cable: string | null;
  points: Vec3[];
}

export interface SceneModel {
  buildings: BuildingModel[];
  areas: AreaModel[];
  devices: DeviceModel[];
  labs: LabModel[];
  links: LinkModel[];
  /** Devices without a building (not WAN): listed by M20, not drawn. */
  unplaced: string[];
  /** Ground rectangle of buildings + areas, for the mini map and the camera. */
  bounds: { x0: number; x1: number; z0: number; z1: number };
}

/** Fibre colours when the registry has none (viz.link_routes.color), from the prototype. */
export const FIBER_FALLBACK = [
  '#00e5ff',
  '#8b6bff',
  '#3dff8f',
  '#ff4fd8',
  '#ff8a5c',
  '#00b3a4',
  '#ffd23f',
  '#c08457',
];

/** Floor height when a building has no shape row (prototype H). */
export const FLOOR_H = 0.9;

const ROLE_KIND: Record<string, DeviceKind> = {
  core: 'core',
  server: 'core',
  main: 'main',
  fiber_point: 'main',
  access: 'access',
  finance_router: 'access',
  media_converter: 'access',
  ap: 'ap',
  nvr: 'nvr',
  camera: 'nvr',
  wan: 'wan',
  controller: 'planned',
};

/** Kind of a device, or null when the 3D view does not draw it (UPS, patch panel, printer …). */
export function deviceKind(d: Pick<Device, 'role' | 'layer' | 'lifecycle'>): DeviceKind | null {
  if (d.layer === 'planned' || d.lifecycle === 'planned') return 'planned';
  return ROLE_KIND[d.role] ?? (d.layer === 'net' ? 'access' : null);
}

/**
 * Computer lab rooms: type computer_lab, or — as SBC ASSET names them today, without a type —
 * a room called "ห้องคอม…" (LOC-031 ห้องคอม 2310, LOC-045 ห้องคอม …).
 */
export function isComputerLab(l: Pick<Layout['locations'][number], 'type' | 'name'>): boolean {
  return l.type === 'computer_lab' || /^ห้องคอม/.test(l.name.trim());
}

export function layerOf(kind: DeviceKind): LayerKey {
  return kind === 'core' || kind === 'main' || kind === 'access' ? 'net' : kind;
}

// ---------- coordinates ----------

/** World point of (u, v) inside a building at height y. */
export function toWorld(b: BuildingModel, u: number, v: number, y: number): Vec3 {
  const lx = u * b.width;
  const lz = v * b.depth;
  const c = Math.cos(b.rotation);
  const s = Math.sin(b.rotation);
  return { x: b.x + lx * c - lz * s, y, z: b.z + lx * s + lz * c };
}

export const floorY = (b: Pick<BuildingModel, 'floorHeight'>, floor: number) =>
  (floor - 1) * b.floorHeight;

const Y_OFFSET: Record<DeviceKind | 'lab', (h: number) => number> = {
  core: () => 0.4,
  main: () => 0.4,
  access: () => 0.4,
  nvr: () => 0.4,
  planned: () => 0.4,
  wan: () => 0,
  ap: (h) => h - 0.15, // under the ceiling
  lab: () => 0.1,
};

/**
 * Rows of the automatic layout, as an offset across the building (fraction of its short side):
 * switches and routers on one side, cameras recorders on the other, APs along the middle under
 * the ceiling, lab plates in between. Ring buildings put everything on the outer band.
 */
const ROW: Record<DeviceKind | 'lab', number> = {
  core: -0.2,
  main: -0.2,
  access: -0.2,
  planned: -0.38,
  ap: 0,
  lab: 0.12,
  nvr: 0.3,
  wan: 0,
};

/** (u, v) of the i-th of n items in a row of a building. */
export function rowSlot(b: BuildingModel, row: number, i: number, n: number): [number, number] {
  const long = b.width >= b.depth;
  const t = n <= 1 ? 0 : -0.42 + ((i + 0.5) * 0.84) / n;
  let s = row;
  if (b.ring) {
    // centre line of the outer band, on the side the row asks for (APs: the near side)
    const across = long ? b.depth : b.width;
    const inner = long ? b.ring[1] : b.ring[0];
    const band = (inner / 2 + (across - inner) / 4) / across;
    s = row > 0 ? band : -band;
  }
  return long ? [t, s] : [s, t];
}

const byName = (a: { name: string; code: string }, b: { name: string; code: string }) =>
  a.name.localeCompare(b.name, 'th', { numeric: true }) || a.code.localeCompare(b.code);

// ---------- routing ----------

interface Frame {
  toF: (p: { x: number; z: number }) => [number, number];
  fromF: (x: number, z: number, y: number) => Vec3;
}

function frameOf(b: BuildingModel): Frame {
  const c = Math.cos(b.rotation);
  const s = Math.sin(b.rotation);
  return {
    toF: (p) => [p.x * c + p.z * s, -p.x * s + p.z * c],
    fromF: (x, z, y) => ({ x: x * c - z * s, y, z: x * s + z * c }),
  };
}

/** Does the ground segment p→q pass through building b (shrunk by `inset`)? */
export function crosses(
  b: Pick<BuildingModel, 'x' | 'z' | 'width' | 'depth' | 'rotation'>,
  p: { x: number; z: number },
  q: { x: number; z: number },
  inset = 0.05,
): boolean {
  const c = Math.cos(b.rotation);
  const s = Math.sin(b.rotation);
  const local = (v: { x: number; z: number }) => {
    const dx = v.x - b.x;
    const dz = v.z - b.z;
    return [dx * c + dz * s, -dx * s + dz * c] as const;
  };
  const [px, pz] = local(p);
  const [qx, qz] = local(q);
  const hw = b.width / 2 - inset;
  const hd = b.depth / 2 - inset;
  // Liang–Barsky clip of the segment against the box
  let t0 = 0;
  let t1 = 1;
  const dx = qx - px;
  const dz = qz - pz;
  const tests: [number, number][] = [
    [-dx, px + hw],
    [dx, hw - px],
    [-dz, pz + hd],
    [dz, hd - pz],
  ];
  for (const [pp, qq] of tests) {
    if (pp === 0) {
      if (qq < 0) return false;
      continue;
    }
    const r = qq / pp;
    if (pp < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t1 - t0 > 1e-6;
}

const dist2 = (a: Vec3, b: Vec3) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

function dedupe(points: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || (last.x - p.x) ** 2 + (last.y - p.y) ** 2 + (last.z - p.z) ** 2 > 1e-6) {
      out.push(p);
    }
  }
  return out;
}

/** Exit points just outside each side of building b, level with device point p. */
function exits(b: BuildingModel, p: Vec3, gap: number, y: number): Vec3[] {
  const F = frameOf(b);
  const [px, pz] = F.toF(p);
  const [cx, cz] = F.toF(b);
  return [
    F.fromF(px, cz - b.depth / 2 - gap, y),
    F.fromF(px, cz + b.depth / 2 + gap, y),
    F.fromF(cx - b.width / 2 - gap, pz, y),
    F.fromF(cx + b.width / 2 + gap, pz, y),
  ];
}

/**
 * Cable run between buildings, like the prototype's routeEdge: up to the cable height, out
 * through a side of the source building, along the walls with right-angle turns, in through a
 * side of the target building. Every side pair and both turn orders are tried in the frames of
 * both buildings; the run that crosses the fewest other buildings, then the shortest, wins.
 * `lane` spreads parallel cables of one source apart.
 */
export function routeBetween(
  a: Vec3,
  b: Vec3,
  src: BuildingModel,
  tgt: BuildingModel,
  lane: number,
  fiber: boolean,
  obstacles: BuildingModel[],
): Vec3[] {
  const y = fiber ? 0.5 + (lane % 4) * 0.18 : 0.2 + (lane % 5) * 0.1;
  const A0 = { x: a.x, y, z: a.z };
  const B0 = { x: b.x, y, z: b.z };
  const base = 0.7 + (lane % 4) * 0.35;
  const others = obstacles.filter((o) => o.code !== src.code && o.code !== tgt.code);
  let best: { pts: Vec3[]; cost: number } | null = null;
  for (const gap of [base, base + 3.5]) {
    for (const S of exits(src, a, gap, y)) {
      for (const T of exits(tgt, b, 0.7 + (lane % 4) * 0.2, y)) {
        for (const F of [frameOf(src), frameOf(tgt)]) {
          const [sx, sz] = F.toF(S);
          const [tx, tz] = F.toF(T);
          for (const C of [F.fromF(tx, sz, y), F.fromF(sx, tz, y)]) {
            const mid = [S, C, T];
            let hits = 0;
            let len = Math.sqrt(dist2(A0, S)) + Math.sqrt(dist2(T, B0));
            for (let i = 0; i < mid.length - 1; i++) {
              const p = mid[i] as Vec3;
              const q = mid[i + 1] as Vec3;
              len += Math.sqrt(dist2(p, q));
              for (const o of others) if (crosses(o, p, q)) hits += 1;
              if (crosses(src, p, q, 0.2) || crosses(tgt, p, q, 0.2)) hits += 1;
            }
            const cost = hits * 1000 + len;
            if (!best || cost < best.cost) best = { pts: [a, A0, S, C, T, B0, b], cost };
          }
        }
      }
    }
  }
  return dedupe((best as { pts: Vec3[] }).pts);
}

// ---------- the model ----------

function linkKind(l: Link, a: DeviceModel, b: DeviceModel): LinkKind {
  if (l.media === 'planned' || a.kind === 'planned' || b.kind === 'planned') return 'planned';
  if (b.kind === 'ap') return 'ap';
  if (l.media === 'pppoe' || b.kind === 'wan') return 'wan';
  if (l.media === 'fiber') return 'fiber';
  if (l.media === 'lacp' || l.media === 'trunk') return 'core';
  return b.kind === 'access' && a.building === b.building ? 'riser' : 'copper';
}

export function buildSceneModel(layout: Layout): SceneModel {
  const buildings: BuildingModel[] = layout.buildings.flatMap((b) => {
    if (!b.shape) return [];
    const ring = (b.shape.extra as { ring?: unknown }).ring;
    return [
      {
        code: b.code,
        name: b.name,
        x: b.shape.x,
        z: b.shape.z,
        width: b.shape.width,
        depth: b.shape.depth,
        rotation: b.shape.rotation,
        floors: Math.max(1, b.floorCount),
        floorHeight: b.shape.floorHeight || FLOOR_H,
        ring:
          Array.isArray(ring) && ring.length === 2 && ring.every((n) => typeof n === 'number')
            ? (ring as [number, number])
            : null,
      },
    ];
  });
  const B = new Map(buildings.map((b) => [b.code, b]));
  const areas: AreaModel[] = layout.areas.map((a) => ({ ...a }));

  // devices: manual placement first, then automatic rows per building floor
  const devices: DeviceModel[] = [];
  const unplaced: string[] = [];
  const rows = new Map<string, Device[]>();
  const wans: Device[] = [];
  const place = (d: Device, kind: DeviceKind, b: BuildingModel, u: number, v: number) => {
    const floor = Math.min(Math.max(d.floor ?? 1, 1), b.floors);
    const y = floorY(b, floor) + Y_OFFSET[kind](b.floorHeight) + (d.placement?.heightOffset ?? 0);
    devices.push({
      code: d.code,
      name: d.name,
      kind,
      layer: layerOf(kind),
      building: b.code,
      floor,
      pos: toWorld(b, u, v, y),
      rotY: -b.rotation,
      device: d,
    });
  };
  for (const d of layout.devices) {
    const kind = deviceKind(d);
    if (!kind) continue;
    if (kind === 'wan') {
      wans.push(d);
      continue;
    }
    const b = d.building ? B.get(d.building) : undefined;
    if (!b) {
      unplaced.push(d.code);
      continue;
    }
    const p = d.placement;
    if (p && p.u !== null && p.v !== null) {
      place(d, kind, b, p.u, p.v);
      continue;
    }
    const key = `${b.code}|${Math.min(Math.max(d.floor ?? 1, 1), b.floors)}|${ROW[kind]}`;
    rows.set(key, [...(rows.get(key) ?? []), d]);
  }
  for (const [key, list] of rows) {
    const b = B.get(key.split('|')[0] as string) as BuildingModel;
    list.sort(byName);
    list.forEach((d, i) => {
      const kind = deviceKind(d) as DeviceKind;
      const [u, v] = rowSlot(b, ROW[kind], i, list.length);
      place(d, kind, b, u, v);
    });
  }

  // WAN: a row of globes above the device they hang off (the gateway), along its building
  const byCode = new Map(devices.map((d) => [d.code, d]));
  wans.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
  wans.forEach((d, i) => {
    const anchor = d.uplink ? byCode.get(d.uplink) : undefined;
    const rot = anchor?.building ? (B.get(anchor.building)?.rotation ?? 0) : 0;
    const k = (i - (wans.length - 1) / 2) * 6.5;
    const o = anchor?.pos ?? { x: 0, y: 0, z: 0 };
    devices.push({
      code: d.code,
      name: d.name,
      kind: 'wan',
      layer: 'wan',
      building: null,
      floor: null,
      pos: { x: o.x + Math.cos(rot) * k, y: 15, z: o.z + Math.sin(rot) * k },
      rotY: 0,
      device: d,
    });
  });
  for (const d of devices) byCode.set(d.code, d);

  // computer labs (SBC ASSET rooms of type computer_lab): plates on their floor
  const labs: LabModel[] = [];
  const labRows = new Map<string, Layout['locations']>();
  for (const l of layout.locations) {
    if (!isComputerLab(l) || !B.has(l.building)) continue;
    const key = `${l.building}|${l.floor}`;
    labRows.set(key, [...(labRows.get(key) ?? []), l]);
  }
  for (const [key, list] of labRows) {
    const b = B.get(key.split('|')[0] as string) as BuildingModel;
    list.sort(
      (x, y) =>
        (x.corridorOrder ?? 1e9) - (y.corridorOrder ?? 1e9) || x.locCode.localeCompare(y.locCode),
    );
    list.forEach((l, i) => {
      const floor = Math.min(Math.max(l.floor, 1), b.floors);
      const [u, v] = rowSlot(b, ROW.lab, i, list.length);
      labs.push({
        locCode: l.locCode,
        name: l.roomNumber && !l.name.includes(l.roomNumber) ? `${l.name} ${l.roomNumber}` : l.name,
        building: b.code,
        floor,
        pcs: l.registryPcCount,
        pos: toWorld(b, u, v, floorY(b, floor) + Y_OFFSET.lab(b.floorHeight)),
        rotY: -b.rotation,
      });
    });
  }

  // cable runs
  const obstacles = [
    ...buildings,
    ...areas
      .filter((a) => a.kind === 'hall')
      .map((a) => ({ ...a, floors: 2, floorHeight: FLOOR_H, ring: null })),
  ];
  const lanes = new Map<string, number>();
  const links: LinkModel[] = [];
  let fibers = 0;
  for (const l of layout.links) {
    const a = byCode.get(l.a);
    const b = byCode.get(l.b);
    if (!a || !b) continue;
    const kind = linkKind(l, a, b);
    let points: Vec3[];
    const sameBuilding = a.building !== null && a.building === b.building;
    if (kind === 'wan') {
      const yh =
        3.4 +
        Math.max(
          0,
          wans.findIndex((w) => w.code === b.code),
        ) *
          0.35;
      points = dedupe([a.pos, { ...a.pos, y: yh }, { ...b.pos, y: yh }, b.pos]);
    } else if (kind === 'ap' || (sameBuilding && kind !== 'planned')) {
      points = [a.pos, b.pos];
    } else {
      const lane = l.lane ?? (lanes.get(l.a) ?? 0) + 1;
      lanes.set(l.a, lane);
      const y = kind === 'fiber' ? 0.5 + (lane % 4) * 0.18 : 0.2 + (lane % 5) * 0.1;
      const sb = a.building ? B.get(a.building) : undefined;
      const tb = b.building ? B.get(b.building) : undefined;
      if (l.waypoints.length) {
        points = dedupe([
          a.pos,
          { ...a.pos, y },
          ...l.waypoints.map(([x, z]) => ({ x, y, z })),
          { ...b.pos, y },
          b.pos,
        ]);
      } else if (sb && tb && sb !== tb) {
        points = routeBetween(a.pos, b.pos, sb, tb, lane, kind === 'fiber', obstacles);
      } else {
        points = dedupe([a.pos, { ...a.pos, y }, { ...b.pos, y }, b.pos]);
      }
    }
    links.push({
      key: `${l.a}>${l.b}`,
      a: l.a,
      b: l.b,
      kind,
      layer:
        kind === 'planned'
          ? 'planned'
          : kind === 'ap'
            ? 'ap'
            : kind === 'wan'
              ? 'wan'
              : b.kind === 'nvr'
                ? 'nvr'
                : 'net',
      color:
        kind === 'fiber'
          ? (l.color ?? (FIBER_FALLBACK[fibers++ % FIBER_FALLBACK.length] as string))
          : null,
      cable: l.cable,
      points,
    });
  }

  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const r of [...buildings, ...areas.filter((a) => a.kind !== 'pool' && a.kind !== 'field')]) {
    const c = Math.cos(r.rotation);
    const s = Math.sin(r.rotation);
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const x = r.x + ((u * r.width) / 2) * c - ((v * r.depth) / 2) * s;
      const z = r.z + ((u * r.width) / 2) * s + ((v * r.depth) / 2) * c;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
  }
  const bounds = isFinite(x0)
    ? { x0: x0 - 4, x1: x1 + 4, z0: z0 - 4, z1: z1 + 4 }
    : { x0: -50, x1: 50, z0: -50, z1: 50 };

  return { buildings, areas, devices, labs, links, unplaced, bounds };
}

/** Uplink tree of the drawn devices: code → codes it feeds. */
export function childrenOf(model: SceneModel): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const l of model.links) out.set(l.a, [...(out.get(l.a) ?? []), l.b]);
  return out;
}
