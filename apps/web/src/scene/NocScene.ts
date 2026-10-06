// M19: the 3D scene of the prototype (docs/prototype/sb-noc-3d-baseline-v3.html) as a plain
// three.js module, independent of React (dependency-cruiser: scene-no-react). It draws a
// SceneModel (model.ts, from the registry) and colours it with the live status (M16).
//
// Kept from the prototype: glass buildings with floor slabs, devices by shape, APs as one
// InstancedMesh, fibre tubes with moving data and light tails, alert beams/rings/halos, bloom,
// building focus + floor cut, fly-to, top view, mini map, labels that avoid each other, badges
// over problem devices, eco mode (auto when the frame rate drops below 24).
//
// Buildings are drawn as wireframes (WIRE): outlines and floor lines carry the shape.
import type { StatusSnapshot } from '@sbc-noc/shared';
import { STATE_ICON, type LayerKey, type UiState } from '@sbc-noc/ui';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { MiniMap } from './minimap.js';
import {
  childrenOf,
  type BuildingModel,
  type DeviceKind,
  type DeviceModel,
  type LabModel,
  type LinkModel,
  type SceneModel,
} from './model.js';
import { isDark, readPalette, type Palette, type PaletteKey } from './palette.js';

export type Selection = { kind: 'device'; code: string } | { kind: 'lab'; locCode: string };

export interface SceneCallbacks {
  onSelect?: (sel: Selection | null) => void;
  /** Average frame rate of each 5-second window. */
  onFps?: (fps: number) => void;
  /** Eco mode switched itself on because the frame rate was too low. */
  onAutoEco?: (fps: number) => void;
}

export interface SceneOptions {
  container: HTMLElement;
  labels: HTMLElement;
  eco?: boolean;
  /** Eco mode may switch on by itself (no saved choice yet). */
  autoEco?: boolean;
  reducedMotion?: boolean;
}

// the map card is smaller than the old full-screen scene, so home sits closer
const HOME = { pos: new THREE.Vector3(-49, 56, 80), tgt: new THREE.Vector3(0, 2, 20) };
const AUTO_ECO_FPS = 24;
const EMISSIVE = 0.35;
/** Wireframe buildings: bright outlines and floor lines, near-clear slabs and glass. */
const WIRE = { edge: 0.95, floor: 0.5, slab: 0.06, fill: 0.03, mull: 0.12, shadow: 0.5 };

type Mat = THREE.MeshLambertMaterial;

interface DevView {
  m: DeviceModel;
  /** Mesh, or null for an AP drawn by the instanced mesh. */
  mesh: THREE.Mesh | null;
  mat: { color: THREE.Color; emissive: THREE.Color; emissiveIntensity: number; opacity: number };
  apIndex: number;
  visible: boolean;
  scale: number;
  state: UiState;
  /** Planned devices stay see-through. */
  maxOpacity: number;
}

interface LabView {
  m: LabModel;
  mesh: THREE.Mesh;
  mat: Mat;
}

interface Dot {
  mesh: THREE.Mesh;
  t: number;
  dir: 1 | -1;
  base: THREE.Color | null;
  tail: Tail[];
}

interface Tail {
  visible: boolean;
  pos: THREE.Vector3;
  k: number;
  j: number;
  op: number;
  color: THREE.Color;
}

interface LinkView {
  m: LinkModel;
  curve: THREE.CurvePath<THREE.Vector3>;
  len: number;
  line: THREE.Object3D | null;
  mat: { color: THREE.Color; opacity: number; transparent: boolean };
  base: () => THREE.Color;
  baseOpacity: number;
  dots: Dot[];
  speed: number;
  state: UiState;
  apIndex: number;
  visible: boolean;
}

interface BuildingView {
  m: BuildingModel;
  group: THREE.Group;
  slabMat: Mat;
  edgeMat: THREE.LineBasicMaterial;
  /** Floor slab (near-invisible fill) and its outline, which carries the wireframe look. */
  slabs: { mesh: THREE.Mesh; line: THREE.LineSegments; floor: number }[];
  floorMat: THREE.LineBasicMaterial;
  edges: THREE.LineSegments;
  inner: THREE.LineSegments | null;
  floorBox: THREE.LineSegments;
  fill: THREE.Mesh | null;
  fillMat: THREE.MeshBasicMaterial | null;
  mull: THREE.LineSegments | null;
  mullMat: THREE.LineBasicMaterial | null;
  halo: THREE.Mesh | null;
  label: HTMLDivElement;
  ring: HTMLSpanElement;
  state: UiState;
}

interface Label {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  /** 0 problem building, 1 building, 2 ISP, 3 open area: who wins a collision. */
  prio: () => number;
  below: boolean;
  w: number;
  h: number;
  /** Device the label names (ISP): hidden while that device has a problem badge. */
  device?: string;
}

interface Fx {
  severity: 'down' | 'warn';
  ring: THREE.Mesh;
  beam: THREE.Mesh | null;
  phase: number;
  code: string;
}

const GEO: Record<DeviceKind | 'lab', () => THREE.BufferGeometry> = {
  core: () => new THREE.BoxGeometry(1.1, 0.4, 0.7),
  main: () => new THREE.OctahedronGeometry(0.6),
  access: () => new THREE.BoxGeometry(0.8, 0.22, 0.45),
  lab: () => new THREE.BoxGeometry(1.2, 0.1, 0.8),
  nvr: () => new THREE.CylinderGeometry(0.2, 0.2, 0.35, 12),
  wan: () => new THREE.SphereGeometry(1.1, 24, 16),
  planned: () => new THREE.OctahedronGeometry(0.55),
  ap: () => new THREE.CylinderGeometry(0.28, 0.28, 0.07, 16),
};

const LINK_COLOR: Record<Exclude<LinkModel['kind'], 'fiber'>, PaletteKey> = {
  core: 'core',
  copper: 'main',
  riser: 'access',
  wan: 'wan',
  ap: 'ap',
  planned: 'planned',
};

function curveOf(points: { x: number; y: number; z: number }[]): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i] as { x: number; y: number; z: number };
    const q = points[i + 1] as { x: number; y: number; z: number };
    path.add(
      new THREE.LineCurve3(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(q.x, q.y, q.z)),
    );
  }
  return path;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** WebGL available? (Old browsers, disabled GPU, jsdom.) */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

export class NocScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.5, 800);
  private readonly controls: OrbitControls;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private C: Palette;
  private readonly reduceUser: boolean;
  /** Data not fresh (UI ลูกเล่น รอบ 2): hold every animation, like reduced motion. */
  private still = false;
  private get reduce(): boolean {
    return this.reduceUser || this.still;
  }
  private eco: boolean;
  private autoEco: boolean;

  private content = new THREE.Group();
  private ground: THREE.Mesh;
  private grid: THREE.GridHelper | null = null;
  private model: SceneModel | null = null;
  private kids = new Map<string, string[]>();
  private devs = new Map<string, DevView>();
  private apList: DevView[] = [];
  private apInst: THREE.InstancedMesh | null = null;
  private labs = new Map<string, LabView>();
  private links: LinkView[] = [];
  private apLinks: LinkView[] = [];
  private apLinkGeo: THREE.BufferGeometry | null = null;
  private tails: Tail[] = [];
  private tailInst: THREE.InstancedMesh | null = null;
  private blds = new Map<string, BuildingView>();
  private themed: [{ color: THREE.Color }, PaletteKey][] = [];
  private labelsList: Label[] = [];
  private badges = new Map<string, HTMLButtonElement>();
  private fx = new Map<string, Fx>();
  private pickables: THREE.Object3D[] = [];
  private waterTex: THREE.Texture | null = null;

  private snap: StatusSnapshot | null = null;
  private layerOn: Record<LayerKey, boolean> = {
    net: true,
    ap: true,
    lab: true,
    nvr: true,
    wan: true,
    planned: true,
  };
  private focusB: string | null = null;
  private floorSel: number | null = null;
  /** Search results highlighted in the view (M20); null = no highlight. */
  private hl: Set<string> | null = null;
  private selected: Selection | null = null;
  private fly: {
    p0: THREE.Vector3;
    t0: THREE.Vector3;
    p1: THREE.Vector3;
    t1: THREE.Vector3;
    k: number;
    spd: number;
  } | null = null;

  private mini: MiniMap | null = null;
  private miniCanvas: HTMLCanvasElement | null = null;
  private miniLast = 0;

  private raf = 0;
  private last = performance.now();
  private fpsStart = 0;
  private fpsFrames = 0;
  private fpsWindows = 0;
  private readonly ro: ResizeObserver | null;
  private readonly cleanups: (() => void)[] = [];
  private readonly tmp = {
    m4: new THREE.Matrix4(),
    q: new THREE.Quaternion(),
    s: new THREE.Vector3(),
    c: new THREE.Color(),
    v: new THREE.Vector3(),
    y: new THREE.Vector3(0, 1, 0),
  };

  constructor(
    private readonly opts: SceneOptions,
    private readonly cb: SceneCallbacks = {},
  ) {
    this.reduceUser = opts.reducedMotion ?? false;
    this.eco = opts.eco ?? false;
    this.autoEco = opts.autoEco ?? false;
    this.C = readPalette();
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.domElement.className = 'scene-canvas';
    opts.container.prepend(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 220;
    this.controls.autoRotateSpeed = 0.6;
    this.camera.position.copy(HOME.pos);
    this.controls.target.copy(HOME.tgt);

    // lights ×π: three ≥ r155 uses physical light units, the prototype (r128) did not
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.9 * Math.PI));
    const dl = new THREE.DirectionalLight(0xffffff, 0.6 * Math.PI);
    dl.position.set(-30, 60, 20);
    this.scene.add(dl);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 180),
      new THREE.MeshBasicMaterial({ color: this.C.ground }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(0, -0.02, 25);
    this.scene.add(this.ground);
    this.makeGrid();
    this.scene.add(this.content);

    try {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(800, 600), 0.6, 0.4, 0.55);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    } catch {
      this.composer = null;
    }

    this.bindPointer();
    this.ro =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.resize());
    this.ro?.observe(opts.container);
    const mq = matchMedia('(prefers-color-scheme: light)');
    const re = () => this.retheme();
    mq.addEventListener('change', re);
    const mo = new MutationObserver(re);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.cleanups.push(
      () => mq.removeEventListener('change', re),
      () => mo.disconnect(),
    );
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => this.labelsList.forEach((l) => (l.w = l.h = 0)));
    }

    this.resize();
    this.retheme();
    if (!this.reduce) {
      // fly in from high above, like the prototype's first frame
      this.camera.position.set(-20, 260, 240);
      this.fly = {
        p0: this.camera.position.clone(),
        t0: HOME.tgt.clone(),
        p1: HOME.pos.clone(),
        t1: HOME.tgt.clone(),
        k: 0,
        spd: 0.4,
      };
    }
    this.raf = requestAnimationFrame(this.tick);
  }

  // ---------- public API ----------

  setModel(model: SceneModel): void {
    this.clearContent();
    this.model = model;
    this.kids = childrenOf(model);
    this.buildBuildings(model);
    this.buildDevices(model);
    this.buildLinks(model);
    if (this.miniCanvas) this.mini = new MiniMap(this.miniCanvas, model);
    if (this.focusB && !this.blds.has(this.focusB)) {
      this.focusB = null;
      this.floorSel = null;
    }
    this.applyStatus();
  }

  setStatus(snap: StatusSnapshot | null): void {
    this.snap = snap;
    this.applyStatus();
  }

  setLayers(on: Record<LayerKey, boolean>): void {
    this.layerOn = { ...on };
    this.applyVisibility();
  }

  setMiniMap(canvas: HTMLCanvasElement | null): void {
    this.miniCanvas = canvas;
    this.mini = canvas && this.model ? new MiniMap(canvas, this.model) : null;
  }

  /** Focus a building (null = whole school) and optionally cut it at a floor. */
  focus(building: string | null, floor: number | null = null, fly = true): void {
    const b = building ? this.blds.get(building) : undefined;
    this.focusB = b ? b.m.code : null;
    this.floorSel = b && floor ? Math.min(floor, b.m.floors) : null;
    this.applyVisibility();
    if (!fly) return;
    if (!b) {
      this.flyTo(HOME.pos.clone(), HOME.tgt.clone());
      return;
    }
    const m = b.m;
    const r = Math.max(m.width, m.depth);
    const c = new THREE.Vector3(m.x, (m.floors * m.floorHeight) / 2, m.z);
    if (this.floorSel) {
      const y = (this.floorSel - 1) * m.floorHeight;
      this.flyTo(
        new THREE.Vector3(c.x - r * 0.25, y + r * 1.1 + 6, c.z + r * 0.9),
        new THREE.Vector3(c.x, y, c.z),
      );
    } else {
      this.flyTo(new THREE.Vector3(c.x - r * 1.1, c.y + r * 0.9 + 6, c.z + r * 1.4), c);
    }
  }

  /** Highlight a device or lab (null clears) and fly to it. */
  select(sel: Selection | null, fly = true): void {
    this.selected = sel;
    for (const d of this.devs.values()) {
      d.scale = 1;
      d.mesh?.scale.setScalar(1);
    }
    for (const l of this.labs.values()) l.mesh.scale.setScalar(1);
    if (!sel) return;
    let p: THREE.Vector3;
    if (sel.kind === 'device') {
      const d = this.devs.get(sel.code);
      if (!d) return;
      d.scale = 1.6;
      if (d.mesh) d.mesh.scale.setScalar(1.6);
      p = new THREE.Vector3(d.m.pos.x, d.m.pos.y, d.m.pos.z);
      if (fly && d.m.building && d.m.building !== this.focusB) {
        const b = this.blds.get(d.m.building);
        this.focus(d.m.building, b && b.m.floors > 1 ? d.m.floor : null, false);
      }
    } else {
      const l = this.labs.get(sel.locCode);
      if (!l) return;
      l.mesh.scale.setScalar(1.4);
      p = l.mesh.position.clone();
    }
    if (fly) this.flyTo(new THREE.Vector3(p.x - 12, p.y + 14, p.z + 16), p);
  }

  /** Highlight search results (M20): they stay visible, everything else fades. null clears. */
  highlight(codes: string[] | null): void {
    this.hl = codes ? new Set(codes) : null;
    this.applyVisibility();
  }

  /** Slow turn around the view (TV mode with nothing to show, M20). */
  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on && !this.reduce;
  }

  home(): void {
    this.focus(null, null, true);
  }

  topView(on: boolean): void {
    if (on) this.flyTo(new THREE.Vector3(0, 150, 20.1), new THREE.Vector3(0, 0, 20));
    else this.flyTo(HOME.pos.clone(), HOME.tgt.clone());
  }

  /** Stop the scene's motion while the data is not fresh; stillness says "this is not live". */
  setStill(on: boolean): void {
    this.still = on;
    this.controls.autoRotate = this.controls.autoRotate && !on;
  }

  setEco(on: boolean): void {
    this.eco = on;
    this.autoEco = false;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.composer?.setPixelRatio(this.pixelRatio());
    for (const t of this.tails) t.visible = false;
    this.resize();
  }

  /** Ground point clicked on the mini map → slide the camera there. */
  miniClick(clientX: number, clientY: number): void {
    if (!this.mini) return;
    const p = this.mini.toWorld(clientX, clientY);
    const t = new THREE.Vector3(p.x, 0, p.z);
    const off = this.camera.position.clone().sub(this.controls.target);
    this.flyTo(t.clone().add(off), t);
  }

  /** Arrow keys on the mini map. */
  pan(dx: number, dz: number): void {
    const dv = new THREE.Vector3(dx, 0, dz);
    this.flyTo(this.camera.position.clone().add(dv), this.controls.target.clone().add(dv));
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.cleanups.forEach((f) => f());
    this.clearContent();
    this.controls.dispose();
    this.composer?.dispose();
    this.disposeTree(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- building the scene ----------

  private pixelRatio() {
    return this.eco ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  }

  private makeGrid() {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
    }
    this.grid = new THREE.GridHelper(180, 60, this.C.grid, this.C.grid);
    const m = this.grid.material as THREE.Material;
    m.transparent = true;
    m.opacity = 0.35;
    this.grid.position.set(0, 0, 25);
    this.scene.add(this.grid);
  }

  private theme<T extends { color: THREE.Color }>(mat: T, key: PaletteKey): T {
    this.themed.push([mat, key]);
    return mat;
  }

  private addLabel(html: string, pos: THREE.Vector3, prio: () => number, below = false) {
    const el = document.createElement('div');
    el.className = below ? 'blabel below' : 'blabel';
    el.innerHTML = html;
    this.opts.labels.appendChild(el);
    const l: Label = { el, pos, prio, below, w: 0, h: 0 };
    this.labelsList.push(l);
    return l;
  }

  private buildBuildings(model: SceneModel) {
    const C = this.C;
    const shadowTex = canvasTexture(128, 128, (g) => {
      const r = g.createRadialGradient(64, 64, 8, 64, 64, 64);
      r.addColorStop(0, 'rgba(0,0,0,0.55)');
      r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 128, 128);
    });
    for (const m of model.buildings) {
      const g = new THREE.Group();
      g.position.set(m.x, 0, m.z);
      g.rotation.y = -m.rotation;
      this.content.add(g);
      const H = m.floorHeight;
      const h = m.floors * H;
      const slabMat = this.theme(
        new THREE.MeshLambertMaterial({
          color: C.slab,
          transparent: true,
          opacity: WIRE.slab,
          depthWrite: false,
        }),
        'slab',
      );
      const edgeMat = this.theme(
        new THREE.LineBasicMaterial({ color: C.edge, transparent: true, opacity: WIRE.edge }),
        'edge',
      );
      const floorMat = this.theme(
        new THREE.LineBasicMaterial({ color: C.edge, transparent: true, opacity: WIRE.floor }),
        'edge',
      );
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(m.width, h, m.depth)),
        edgeMat,
      );
      edges.position.y = h / 2;
      g.add(edges);
      const floorBox = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(m.width, H, m.depth)),
        edgeMat,
      );
      floorBox.visible = false;
      g.add(floorBox);
      const slabs: BuildingView['slabs'] = [];
      for (let f = 0; f < m.floors; f++) {
        const parts: [number, number, number, number][] = [];
        if (m.ring) {
          const [iw, id] = m.ring;
          const sd = (m.depth - id) / 2;
          const sw = (m.width - iw) / 2;
          parts.push(
            [m.width, sd, 0, -(id + sd) / 2],
            [m.width, sd, 0, (id + sd) / 2],
            [sw, id, -(iw + sw) / 2, 0],
            [sw, id, (iw + sw) / 2, 0],
          );
        } else parts.push([m.width, m.depth, 0, 0]);
        for (const [w, d, x, z] of parts) {
          const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), slabMat);
          s.position.set(x, f * H, z);
          g.add(s);
          const line = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2)),
            floorMat,
          );
          line.position.set(x, f * H + 0.05, z);
          g.add(line);
          slabs.push({ mesh: s, line, floor: f });
        }
      }
      let inner: THREE.LineSegments | null = null;
      if (m.ring) {
        inner = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(m.ring[0], h, m.ring[1])),
          edgeMat,
        );
        inner.position.y = h / 2;
        g.add(inner);
      }
      // ground shadow, glass skin and mullions
      const sh = new THREE.Mesh(
        new THREE.PlaneGeometry(m.width * 1.45, m.depth * 1.45),
        new THREE.MeshBasicMaterial({
          map: shadowTex,
          transparent: true,
          opacity: WIRE.shadow,
          depthWrite: false,
        }),
      );
      sh.rotation.x = -Math.PI / 2;
      sh.position.y = 0.012;
      g.add(sh);
      let fill: THREE.Mesh | null = null;
      let fillMat: THREE.MeshBasicMaterial | null = null;
      let mull: THREE.LineSegments | null = null;
      let mullMat: THREE.LineBasicMaterial | null = null;
      if (!m.ring) {
        fillMat = this.theme(
          new THREE.MeshBasicMaterial({
            color: C.slab,
            transparent: true,
            opacity: WIRE.fill,
            depthWrite: false,
          }),
          'slab',
        );
        fill = new THREE.Mesh(new THREE.BoxGeometry(m.width, h, m.depth), fillMat);
        fill.position.y = h / 2;
        g.add(fill);
        const pts: THREE.Vector3[] = [];
        const long = m.width >= m.depth;
        const L = long ? m.width : m.depth;
        const S = long ? m.depth : m.width;
        const n = Math.max(2, Math.floor(L / 1.6));
        for (let i = 1; i < n; i++) {
          const t = -L / 2 + (i * L) / n;
          for (const o of [-S / 2, S / 2]) {
            const x = long ? t : o;
            const z = long ? o : t;
            pts.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, h, z));
          }
        }
        mullMat = this.theme(
          new THREE.LineBasicMaterial({ color: C.edge, transparent: true, opacity: WIRE.mull }),
          'edge',
        );
        mull = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mullMat);
        g.add(mull);
      }
      const view: BuildingView = {
        m,
        group: g,
        slabMat,
        edgeMat,
        floorMat,
        slabs,
        edges,
        inner,
        floorBox,
        fill,
        fillMat,
        mull,
        mullMat,
        halo: null,
        label: null as unknown as HTMLDivElement,
        ring: null as unknown as HTMLSpanElement,
        state: 'ok',
      };
      const label = this.addLabel(
        `<span class="ring"></span>${escapeHtml(m.name)}<small>${m.floors} ชั้น</small>`,
        new THREE.Vector3(m.x, h + 0.8, m.z),
        () => (view.state !== 'ok' ? 0 : 1),
      );
      view.label = label.el;
      view.ring = label.el.querySelector('.ring') as HTMLSpanElement;
      this.blds.set(m.code, view);
    }

    // open areas: playground, dome, pool, football field
    const fieldTex = canvasTexture(64, 256, (g) => {
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#2f7d4f' : '#276b43';
        g.fillRect(0, i * 32, 64, 32);
      }
      g.strokeStyle = 'rgba(255,255,255,.55)';
      g.lineWidth = 2;
      g.strokeRect(4, 4, 56, 248);
      g.beginPath();
      g.moveTo(4, 128);
      g.lineTo(60, 128);
      g.stroke();
      g.beginPath();
      g.arc(32, 128, 12, 0, 7);
      g.stroke();
    });
    const waterTex = canvasTexture(128, 128, (g) => {
      g.fillStyle = '#1d6f9e';
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(180,230,255,.35)';
      for (let i = 0; i < 22; i++) {
        const y = (i * 37) % 128;
        const x = (i * 53) % 128;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + 8, y - 3, x + 18, y);
        g.stroke();
      }
    });
    waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
    this.waterTex = waterTex;
    for (const a of model.areas) {
      const g = new THREE.Group();
      g.position.set(a.x, 0, a.z);
      g.rotation.y = -a.rotation;
      this.content.add(g);
      const hall = a.kind === 'hall';
      const h = hall ? 2 * 0.9 : 0.15;
      if (hall) {
        const e = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(a.width, h, a.depth)),
          this.theme(
            new THREE.LineBasicMaterial({ color: C.edge, transparent: true, opacity: 0.8 }),
            'edge',
          ),
        );
        e.position.y = h / 2;
        g.add(e);
      } else {
        const e = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.PlaneGeometry(a.width, a.depth).rotateX(-Math.PI / 2)),
          this.theme(
            new THREE.LineDashedMaterial({
              color: C.planned,
              dashSize: 0.6,
              gapSize: 0.4,
              transparent: true,
              opacity: 0.8,
            }),
            'planned',
          ),
        );
        e.position.y = 0.05;
        e.computeLineDistances();
        g.add(e);
      }
      const key: PaletteKey = a.kind === 'pool' ? 'wan' : a.kind === 'field' ? 'main' : 'slab';
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(a.width, 0.06, a.depth),
        this.theme(
          new THREE.MeshBasicMaterial({
            color: C[key],
            transparent: true,
            opacity: hall || a.kind === 'play' ? 0.45 : 0.22,
          }),
          key,
        ),
      );
      top.position.y = hall ? h : 0.03;
      g.add(top);
      const tex = a.kind === 'field' ? fieldTex : a.kind === 'pool' ? waterTex : null;
      if (tex) {
        const p = new THREE.Mesh(
          new THREE.PlaneGeometry(a.width, a.depth),
          new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            opacity: a.kind === 'pool' ? 0.75 : 0.55,
            depthWrite: false,
          }),
        );
        p.rotation.x = -Math.PI / 2;
        p.position.y = 0.045;
        g.add(p);
      }
      this.addLabel(
        escapeHtml(a.name),
        new THREE.Vector3(a.x, h + 0.8, a.z),
        () => 3,
      ).el.classList.add('quiet', 'area');
    }
  }

  private buildDevices(model: SceneModel) {
    const C = this.C;
    const geos = new Map<string, THREE.BufferGeometry>();
    const geo = (k: DeviceKind | 'lab') => {
      let g = geos.get(k);
      if (!g) {
        g = GEO[k]();
        geos.set(k, g);
      }
      return g;
    };
    for (const m of model.devices) {
      const base = C[m.kind];
      if (m.kind === 'ap') {
        const v: DevView = {
          m,
          mesh: null,
          mat: {
            color: base.clone(),
            emissive: base.clone(),
            emissiveIntensity: EMISSIVE,
            opacity: 1,
          },
          apIndex: this.apList.length,
          visible: true,
          scale: 1,
          state: 'ok',
          maxOpacity: 1,
        };
        this.apList.push(v);
        this.devs.set(m.code, v);
        continue;
      }
      const mat = new THREE.MeshLambertMaterial({
        color: base,
        emissive: base,
        emissiveIntensity: EMISSIVE,
        transparent: m.kind === 'planned',
        opacity: m.kind === 'planned' ? 0.55 : 1,
        wireframe: m.kind === 'planned',
      });
      const mesh = new THREE.Mesh(geo(m.kind), mat);
      mesh.position.set(m.pos.x, m.pos.y, m.pos.z);
      mesh.rotation.y = m.rotY;
      mesh.userData = { code: m.code };
      this.content.add(mesh);
      this.pickables.push(mesh);
      this.devs.set(m.code, {
        m,
        mesh,
        mat,
        apIndex: -1,
        visible: true,
        scale: 1,
        state: 'ok',
        maxOpacity: mat.opacity,
      });
      if (m.kind === 'wan') {
        const l = this.addLabel(
          escapeHtml(m.name),
          new THREE.Vector3(m.pos.x, m.pos.y - 1.6, m.pos.z),
          () => 2,
          true,
        );
        l.device = m.code;
        l.el.classList.add('quiet');
      }
    }
    if (this.apList.length) {
      const inst = new THREE.InstancedMesh(
        geo('ap'),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
        this.apList.length,
      );
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.userData = { ap: true };
      this.content.add(inst);
      this.pickables.push(inst);
      this.apInst = inst;
    }
    for (const m of model.labs) {
      const mat = this.theme(
        new THREE.MeshLambertMaterial({
          color: C.lab,
          emissive: C.lab,
          emissiveIntensity: EMISSIVE,
        }),
        'lab',
      );
      const mesh = new THREE.Mesh(geo('lab'), mat);
      mesh.position.set(m.pos.x, m.pos.y, m.pos.z);
      mesh.rotation.y = m.rotY;
      mesh.userData = { lab: m.locCode };
      this.content.add(mesh);
      this.pickables.push(mesh);
      this.labs.set(m.locCode, { m, mesh, mat });
    }
  }

  private buildLinks(model: SceneModel) {
    const C = this.C;
    const dotGeo = new Map<number, THREE.SphereGeometry>();
    const sphere = (r: number) => {
      let g = dotGeo.get(r);
      if (!g) {
        g = new THREE.SphereGeometry(r, r > 0.2 ? 10 : 8, r > 0.2 ? 8 : 6);
        dotGeo.set(r, g);
      }
      return g;
    };
    for (const m of model.links) {
      const curve = curveOf(m.points);
      const len = curve.getLength() || 1;
      if (m.kind === 'ap') {
        const color = C.ap.clone();
        const v: LinkView = {
          m,
          curve,
          len,
          line: null,
          mat: { color, opacity: 0.3, transparent: true },
          base: () => this.C.ap,
          baseOpacity: 0.3,
          dots: [],
          speed: 0,
          state: 'ok',
          apIndex: this.apLinks.length,
          visible: true,
        };
        this.apLinks.push(v);
        this.links.push(v);
        continue;
      }
      if (m.kind === 'fiber') {
        const fc = new THREE.Color(m.color ?? '#00e5ff');
        const mat = new THREE.MeshBasicMaterial({ color: fc.clone(), transparent: true });
        const line = new THREE.Mesh(new THREE.TubeGeometry(curve, 260, 0.14, 6, false), mat);
        this.content.add(line);
        const bright = fc.clone().lerp(new THREE.Color('#ffffff'), 0.55);
        const dots: Dot[] = [];
        for (let i = 0; i < 7; i++) {
          const back = i >= 5;
          const dm = new THREE.MeshBasicMaterial({
            color: back ? fc.clone() : bright.clone(),
            transparent: true,
          });
          const mesh = new THREE.Mesh(sphere(back ? 0.2 : 0.27), dm);
          this.content.add(mesh);
          const tail: Tail[] = [1, 2, 3, 4].map((j) => {
            const t: Tail = {
              visible: false,
              pos: new THREE.Vector3(),
              k: (back ? 0.2 / 0.27 : 1) * (1 - j * 0.18),
              j,
              op: 0.55 - j * 0.12,
              color: dm.color.clone(),
            };
            this.tails.push(t);
            return t;
          });
          dots.push({
            mesh,
            t: back ? (i - 5) / 2 + 0.25 : i / 5,
            dir: back ? -1 : 1,
            base: dm.color.clone(),
            tail,
          });
        }
        this.links.push({
          m,
          curve,
          len,
          line,
          mat,
          base: () => fc,
          baseOpacity: 1,
          dots,
          speed: 7 / len,
          state: 'ok',
          apIndex: -1,
          visible: true,
        });
        continue;
      }
      const key = LINK_COLOR[m.kind];
      const planned = m.kind === 'planned';
      const mat = planned
        ? new THREE.LineDashedMaterial({
            color: C.planned,
            dashSize: 0.8,
            gapSize: 0.6,
            transparent: true,
            opacity: 0.7,
          })
        : new THREE.LineBasicMaterial({ color: C[key], transparent: true, opacity: 0.85 });
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(
          curve.getSpacedPoints(Math.max(2, Math.min(160, m.points.length * 8))),
        ),
        mat,
      );
      if (planned) line.computeLineDistances();
      this.content.add(line);
      const n = planned ? 0 : m.kind === 'riser' ? 1 : m.kind === 'core' ? 4 : 2;
      const dots: Dot[] = [];
      for (let i = 0; i < n; i++) {
        const mesh = new THREE.Mesh(
          sphere(m.kind === 'riser' ? 0.09 : 0.14),
          new THREE.MeshBasicMaterial({ color: mat.color.clone(), transparent: true }),
        );
        this.content.add(mesh);
        dots.push({ mesh, t: i / n, dir: 1, base: null, tail: [] });
      }
      this.links.push({
        m,
        curve,
        len,
        line,
        mat,
        base: () => this.C[key],
        baseOpacity: planned ? 0.7 : 0.85,
        dots,
        speed: m.kind === 'wan' ? 0.25 : m.kind === 'riser' ? 0.35 : 0.18,
        state: 'ok',
        apIndex: -1,
        visible: true,
      });
    }
    if (this.apLinks.length) {
      const n = this.apLinks.length;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
      const seg = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
      seg.frustumCulled = false;
      this.content.add(seg);
      this.apLinkGeo = geo;
    }
    if (this.tails.length) {
      const inst = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.27, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
        this.tails.length,
      );
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.frustumCulled = false;
      this.content.add(inst);
      this.tailInst = inst;
    }
  }

  private clearContent() {
    for (const l of this.labelsList) l.el.remove();
    for (const b of this.badges.values()) b.remove();
    this.labelsList = [];
    this.badges.clear();
    this.fx.clear();
    this.scene.remove(this.content);
    this.disposeTree(this.content);
    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.devs.clear();
    this.apList = [];
    this.apInst = null;
    this.labs.clear();
    this.links = [];
    this.apLinks = [];
    this.apLinkGeo = null;
    this.tails = [];
    this.tailInst = null;
    this.blds.clear();
    this.themed = [];
    this.pickables = [];
    this.waterTex = null;
  }

  private disposeTree(root: THREE.Object3D) {
    const seen = new Set<unknown>();
    root.traverse((o) => {
      const any = o as Partial<THREE.Mesh>;
      if (any.geometry && !seen.has(any.geometry)) {
        seen.add(any.geometry);
        any.geometry.dispose();
      }
      const mats = any.material
        ? Array.isArray(any.material)
          ? any.material
          : [any.material]
        : [];
      for (const m of mats as THREE.Material[]) {
        if (seen.has(m)) continue;
        seen.add(m);
        const map = (m as THREE.MeshBasicMaterial).map;
        if (map && !seen.has(map)) {
          seen.add(map);
          map.dispose();
        }
        m.dispose();
      }
    });
  }

  // ---------- status ----------

  private stateOf(code: string): UiState {
    return (this.snap?.states[code] as UiState | undefined) ?? 'ok';
  }

  private colorOf(kind: DeviceKind, st: UiState): THREE.Color {
    const C = this.C;
    return st === 'down'
      ? C.down
      : st === 'warn'
        ? C.warn
        : st === 'cut'
          ? C.muted
          : st === 'maint'
            ? C.planned
            : C[kind];
  }

  private applyStatus() {
    if (!this.model) return;
    const C = this.C;
    // a down device behind a down root cause went out with it: grey like the cut-off ones, so
    // only the root cause is red
    const follows = new Set(
      (this.snap?.incidents ?? []).filter((i) => i.root !== null).map((i) => i.device),
    );
    for (const d of this.devs.values()) {
      d.state = d.m.kind === 'planned' ? 'ok' : this.stateOf(d.m.code);
      if (d.state === 'down' && follows.has(d.m.code)) d.state = 'cut';
      const c = this.colorOf(d.m.kind, d.state);
      d.mat.color.copy(c);
      d.mat.emissive.copy(c);
      d.mat.emissiveIntensity = EMISSIVE;
    }
    const online = this.snap?.labOnline ?? {};
    for (const l of this.labs.values()) {
      // a lab whose PCs are all offline (e.g. its switch is down) turns grey; information only
      const on = online[l.m.locCode];
      const c = on === 0 && (l.m.pcs ?? 0) > 0 ? C.muted : C.lab;
      l.mat.color.copy(c);
      l.mat.emissive.copy(c);
    }
    for (const l of this.links) {
      l.state = this.devs.get(l.m.b)?.state ?? this.stateOf(l.m.b);
      const base = l.base();
      const st = l.state;
      l.mat.color.copy(
        st === 'ok' ? base : st === 'down' ? C.down : st === 'warn' ? C.warn : C.muted,
      );
      for (const d of l.dots) {
        const mm = d.mesh.material as THREE.MeshBasicMaterial;
        mm.color.copy(st === 'ok' && d.base ? d.base : l.mat.color);
        for (const t of d.tail) t.color.copy(mm.color);
      }
    }
    // buildings take their worst device state: a root cause = down (red), only devices out
    // behind a root cause elsewhere = cut (grey, dashed)
    for (const b of this.blds.values()) {
      let st: UiState = 'ok';
      for (const d of this.devs.values()) {
        if (d.m.building !== b.m.code || d.m.kind === 'planned') continue;
        if (d.state === 'down') st = 'down';
        else if (d.state === 'cut' && st !== 'down') st = 'cut';
        else if (d.state === 'warn' && st !== 'down' && st !== 'cut') st = 'warn';
        else if (d.state === 'maint' && st === 'ok') st = 'maint';
      }
      b.state = st;
      b.ring.className = `ring ${st}`;
      // a building without a problem gets a small plain name (declutter); problems stand out
      b.label.classList.toggle('quiet', st === 'ok' || st === 'maint');
    }
    for (const l of this.labelsList) l.w = l.h = 0; // label sizes change with the style
    this.syncFx();
    this.syncBadges();
    this.applyVisibility();
  }

  /** Incidents with a beam, ring and badge: root causes and single ones (not their followers). */
  private incidents() {
    return (this.snap?.incidents ?? []).filter((i) => i.root === null && this.devs.has(i.device));
  }

  private beamMat(c: THREE.Color, op: number) {
    return new THREE.MeshBasicMaterial({
      color: c.clone(),
      transparent: true,
      opacity: op,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: isDark(this.C) ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
  }

  private removeFx(f: Fx) {
    for (const o of [f.ring, f.beam]) {
      if (!o) continue;
      this.content.remove(o);
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  }

  private syncFx() {
    const incs = this.incidents();
    const want = new Set(incs.map((i) => i.device));
    for (const [code, f] of this.fx) {
      if (!want.has(code)) {
        this.removeFx(f);
        this.fx.delete(code);
      }
    }
    incs.forEach((i, k) => {
      const old = this.fx.get(i.device);
      if (old?.severity === i.severity) return;
      if (old) this.removeFx(old);
      const d = this.devs.get(i.device) as DevView;
      const c = i.severity === 'down' ? this.C.down : this.C.warn;
      const p = d.m.pos;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 56), this.beamMat(c, 0.6));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, d.m.kind === 'wan' ? p.y : 0.05, p.z);
      this.content.add(ring);
      let beam: THREE.Mesh | null = null;
      if (i.severity === 'down') {
        beam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.2, 0.2, 40, 14, 1, true),
          this.beamMat(c, 0.35),
        );
        beam.position.set(p.x, p.y + 20, p.z);
        this.content.add(beam);
      }
      this.fx.set(i.device, { severity: i.severity, ring, beam, phase: k * 0.37, code: i.device });
    });
    // red halo over buildings with a down device or devices cut off
    for (const b of this.blds.values()) {
      const hit = b.state === 'down';
      if (hit && !b.halo) {
        const h = b.m.floors * b.m.floorHeight;
        b.halo = new THREE.Mesh(
          new THREE.BoxGeometry(b.m.width + 0.8, h + 0.8, b.m.depth + 0.8),
          this.beamMat(this.C.down, 0.07),
        );
        b.halo.position.y = h / 2;
        b.group.add(b.halo);
      }
      if (b.halo) b.halo.visible = hit;
    }
  }

  private syncBadges() {
    const incs = this.incidents();
    const want = new Set(incs.map((i) => i.device));
    for (const [code, el] of this.badges) {
      if (!want.has(code)) {
        el.remove();
        this.badges.delete(code);
      }
    }
    for (const i of incs) {
      let el = this.badges.get(i.device);
      if (!el) {
        const b = document.createElement('button');
        b.type = 'button';
        el = b;
        const code = i.device;
        el.addEventListener('click', () => {
          this.select({ kind: 'device', code });
          this.cb.onSelect?.({ kind: 'device', code });
        });
        this.opts.labels.appendChild(b);
        this.badges.set(i.device, b);
      }
      const d = this.devs.get(i.device) as DevView;
      el.className = `badge ${i.severity}`;
      el.textContent = `${STATE_ICON[i.severity]} ${d.m.name}`;
    }
  }

  // ---------- visibility ----------

  private devVisible(d: DevView, incIds: Set<string>) {
    const m = d.m;
    return (
      (this.layerOn[m.layer] || incIds.has(m.code)) &&
      !(
        this.focusB &&
        this.floorSel &&
        m.building === this.focusB &&
        (m.floor ?? 0) > this.floorSel
      )
    );
  }

  private applyVisibility() {
    if (!this.model) return;
    const focus = this.focusB;
    const fs = this.floorSel;
    for (const b of this.blds.values()) {
      const dim = !!focus && b.m.code !== focus;
      const cut = b.m.code === focus && !!fs;
      b.slabMat.opacity = dim ? WIRE.slab / 3 : WIRE.slab;
      b.edgeMat.opacity = dim ? 0.18 : WIRE.edge;
      b.floorMat.opacity = dim ? 0.1 : WIRE.floor;
      for (const s of b.slabs) s.mesh.visible = s.line.visible = !cut || s.floor <= (fs ?? 0) - 1;
      b.edges.visible = !cut;
      if (b.inner) b.inner.visible = !cut;
      b.floorBox.visible = cut;
      if (cut) b.floorBox.position.y = ((fs ?? 1) - 1) * b.m.floorHeight + b.m.floorHeight / 2;
      if (b.fillMat && b.mullMat && b.fill && b.mull) {
        b.fillMat.opacity = dim ? WIRE.fill / 4 : WIRE.fill;
        b.mullMat.opacity = dim ? 0.04 : WIRE.mull;
        b.fill.visible = b.mull.visible = !cut;
      }
      b.label.classList.toggle('dim', dim);
    }
    const incIds = new Set(this.incidents().map((i) => i.device));
    const hl = this.hl;
    for (const d of this.devs.values()) {
      d.visible = this.devVisible(d, incIds) || !!hl?.has(d.m.code);
      const faded = (focus && d.m.building !== focus) || (hl && !hl.has(d.m.code));
      d.mat.opacity = Math.min(faded ? 0.12 : 1, d.maxOpacity);
      if (d.mesh) {
        d.mesh.visible = d.visible;
        const mm = d.mesh.material as Mat;
        mm.transparent = true;
        mm.opacity = d.mat.opacity;
      }
    }
    for (const l of this.labs.values()) {
      l.mesh.visible =
        this.layerOn.lab && !(focus && fs && l.m.building === focus && l.m.floor > fs);
      l.mat.transparent = true;
      l.mat.opacity = focus && l.m.building !== focus ? 0.12 : 1;
    }
    for (const l of this.links) {
      const a = this.devs.get(l.m.a);
      const b = this.devs.get(l.m.b);
      const vis = !!a && !!b && this.layerOn[l.m.layer] && a.visible && b.visible;
      const rel =
        (!focus || a?.m.building === focus || b?.m.building === focus) &&
        (!hl || hl.has(l.m.a) || hl.has(l.m.b));
      l.visible = vis;
      if (l.line) l.line.visible = vis;
      l.mat.transparent = true;
      l.mat.opacity = rel ? l.baseOpacity : 0.07;
      for (const d of l.dots) {
        const mm = d.mesh.material as THREE.MeshBasicMaterial;
        mm.opacity = rel ? 1 : 0.1;
        for (const t of d.tail) t.op = (0.55 - t.j * 0.12) * (rel ? 1 : 0.1);
      }
    }
  }

  // ---------- frame loop ----------

  private flyTo(pos: THREE.Vector3, tgt: THREE.Vector3) {
    this.fly = {
      p0: this.camera.position.clone(),
      t0: this.controls.target.clone(),
      p1: pos,
      t1: tgt,
      k: 0,
      spd: 1.4,
    };
  }

  private resize() {
    const w = this.opts.container.clientWidth || 1;
    const h = this.opts.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w < 720 ? 58 : 45;
    this.camera.updateProjectionMatrix();
    for (const l of this.labelsList) l.w = l.h = 0;
  }

  private retheme() {
    this.C = readPalette();
    const C = this.C;
    this.scene.background = C.bg;
    (this.ground.material as THREE.MeshBasicMaterial).color.copy(C.ground);
    this.makeGrid();
    for (const [m, k] of this.themed) m.color.copy(C[k]);
    for (const f of this.fx.values()) {
      for (const o of [f.ring, f.beam]) {
        if (!o) continue;
        const m = o.material as THREE.MeshBasicMaterial;
        m.blending = isDark(C) ? THREE.AdditiveBlending : THREE.NormalBlending;
        m.needsUpdate = true;
      }
    }
    this.applyStatus();
  }

  private useBloom() {
    return !!this.composer && !this.eco && isDark(this.C);
  }

  private syncInstances() {
    const { m4, q, s, c, y } = this.tmp;
    const C = this.C;
    if (this.apInst) {
      for (const d of this.apList) {
        const sc = d.visible ? d.scale : 0.0001;
        q.setFromAxisAngle(y, d.m.rotY);
        s.set(sc, sc, sc);
        m4.compose(this.tmp.v.set(d.m.pos.x, d.m.pos.y, d.m.pos.z), q, s);
        this.apInst.setMatrixAt(d.apIndex, m4);
        c.copy(d.mat.color)
          .multiplyScalar(0.75 + 0.5 * d.mat.emissiveIntensity)
          .lerp(C.bg, 1 - d.mat.opacity);
        this.apInst.setColorAt(d.apIndex, c);
      }
      this.apInst.instanceMatrix.needsUpdate = true;
      if (this.apInst.instanceColor) this.apInst.instanceColor.needsUpdate = true;
    }
    if (this.apLinkGeo) {
      const pos = this.apLinkGeo.attributes.position as THREE.BufferAttribute;
      const col = this.apLinkGeo.attributes.color as THREE.BufferAttribute;
      for (const l of this.apLinks) {
        const a = l.m.points[0] as { x: number; y: number; z: number };
        const b = l.visible ? (l.m.points[l.m.points.length - 1] as typeof a) : a;
        const o = l.apIndex * 2;
        pos.setXYZ(o, a.x, a.y, a.z);
        pos.setXYZ(o + 1, b.x, b.y, b.z);
        c.copy(l.mat.color).lerp(C.bg, 1 - l.mat.opacity);
        col.setXYZ(o, c.r, c.g, c.b);
        col.setXYZ(o + 1, c.r, c.g, c.b);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
    if (this.tailInst) {
      q.identity();
      this.tails.forEach((t, i) => {
        const sc = t.visible ? t.k : 0.0001;
        s.set(sc, sc, sc);
        m4.compose(t.pos, q, s);
        this.tailInst?.setMatrixAt(i, m4);
        c.copy(t.color).lerp(C.bg, 1 - t.op);
        this.tailInst?.setColorAt(i, c);
      });
      this.tailInst.instanceMatrix.needsUpdate = true;
      if (this.tailInst.instanceColor) this.tailInst.instanceColor.needsUpdate = true;
    }
  }

  private animate(now: number, dt: number) {
    const incs = this.incidents();
    if (!this.reduce) {
      for (const l of this.links) {
        for (const d of l.dots) {
          const stop = l.state !== 'ok' && l.state !== 'warn';
          d.mesh.visible = l.visible && !stop;
          if (!d.mesh.visible) {
            for (const t of d.tail) t.visible = false;
            continue;
          }
          d.t = (((d.t + dt * l.speed * (l.state === 'warn' ? 0.3 : 1) * d.dir) % 1) + 1) % 1;
          l.curve.getPoint(d.t, d.mesh.position);
          const on = !this.eco;
          for (const t of d.tail) {
            t.visible = on;
            if (on) {
              const tt = (((d.t - (d.dir * t.j * 0.5) / l.len) % 1) + 1) % 1;
              l.curve.getPoint(tt, t.pos);
            }
          }
        }
      }
    } else {
      for (const l of this.links) for (const d of l.dots) d.mesh.visible = false;
    }
    for (const f of this.fx.values()) {
      const vis = this.devs.get(f.code)?.visible ?? false;
      const fr = (now / 1500 + f.phase) % 1;
      f.ring.visible = vis;
      f.ring.scale.setScalar(this.reduce ? 2.5 : 1 + fr * (f.severity === 'down' ? 6 : 3.5));
      (f.ring.material as THREE.MeshBasicMaterial).opacity = this.reduce ? 0.4 : 0.65 * (1 - fr);
      if (f.beam) {
        f.beam.visible = vis;
        (f.beam.material as THREE.MeshBasicMaterial).opacity = this.reduce
          ? 0.3
          : 0.22 + 0.14 * Math.abs(Math.sin(now / 420 + f.phase));
      }
    }
    for (const b of this.blds.values()) {
      if (b.halo?.visible) {
        (b.halo.material as THREE.MeshBasicMaterial).opacity = this.reduce
          ? 0.07
          : 0.04 + 0.05 * Math.abs(Math.sin(now / 600));
      }
    }
    if (this.waterTex && !this.reduce) {
      this.waterTex.offset.set((now / 40000) % 1, (now / 60000) % 1);
    }
    for (const i of incs) {
      const d = this.devs.get(i.device);
      if (!d) continue;
      d.mat.emissiveIntensity = this.reduce
        ? 0.8
        : i.severity === 'down'
          ? 0.35 + 0.65 * Math.abs(Math.sin(now / 300))
          : 0.35 + 0.4 * Math.abs(Math.sin(now / 700));
    }
  }

  private placeLabels() {
    const W = this.opts.container.clientWidth;
    const Hh = this.opts.container.clientHeight;
    const v = this.tmp.v;
    const placed: [number, number, number, number][] = [];
    const overlaps = (r: [number, number, number, number]) =>
      placed.some(
        (p) =>
          r[0] < p[0] + p[2] + 4 &&
          r[0] + r[2] + 4 > p[0] &&
          r[1] < p[1] + p[3] + 2 &&
          r[1] + r[3] + 2 > p[1],
      );
    // problem badges first: they never hide; one that would cover another moves up a row
    const bs = [...this.badges].flatMap(([code, el]) => {
      const d = this.devs.get(code);
      if (!d) return [];
      v.set(d.m.pos.x, d.m.pos.y + 1.3, d.m.pos.z).project(this.camera);
      if (v.z > 1 || !d.visible) {
        el.style.display = 'none';
        return [];
      }
      el.style.display = 'block';
      const down = el.classList.contains('down') ? 0 : 1;
      return [{ el, sx: ((v.x + 1) / 2) * W, sy: ((1 - v.y) / 2) * Hh, down }];
    });
    bs.sort((a, b) => a.down - b.down || a.sy - b.sy);
    for (const b of bs) {
      const bw = b.el.offsetWidth || 90;
      const bh = b.el.offsetHeight || 20;
      const x = Math.max(bw / 2 + 4, Math.min(W - bw / 2 - 4, b.sx));
      let y = Math.max(bh + 4, Math.min(Hh - 4, b.sy));
      for (let k = 0; k < 4 && overlaps([x - bw / 2, y - bh, bw, bh]); k++) y -= bh + 3;
      y = Math.max(bh + 4, y);
      placed.push([x - bw / 2, y - bh, bw, bh]);
      b.el.style.left = `${x}px`;
      b.el.style.top = `${y}px`;
    }
    const items = this.labelsList.map((l) => {
      v.copy(l.pos).project(this.camera);
      return { l, sx: ((v.x + 1) / 2) * W, sy: ((1 - v.y) / 2) * Hh, off: v.z > 1, p: l.prio() };
    });
    items.sort((a, b) => a.p - b.p);
    for (const o of items) {
      const el = o.l.el;
      const w = o.l.w || (o.l.w = el.offsetWidth || 80);
      const h = o.l.h || (o.l.h = el.offsetHeight || 20);
      const rect: [number, number, number, number] = [
        o.sx - w / 2,
        o.l.below ? o.sy : o.sy - h,
        w,
        h,
      ];
      const hit = overlaps(rect);
      const show = !o.off && !hit && !(o.l.device && this.badges.has(o.l.device));
      el.style.visibility = show ? 'visible' : 'hidden';
      if (show) {
        placed.push(rect);
        el.style.left = `${Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, o.sx))}px`;
        el.style.top = `${Math.max(o.l.below ? 4 : h + 4, Math.min(Hh - 4, o.sy))}px`;
      }
    }
  }

  private drawMini(now: number) {
    if (!this.mini || !this.miniCanvas || this.miniCanvas.offsetParent === null) return;
    if (now - this.miniLast < 150) return;
    this.miniLast = now;
    const rc = new THREE.Raycaster();
    const footprint = (
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const
    ).map(([x, y]) => {
      rc.setFromCamera(new THREE.Vector2(x, y), this.camera);
      const o = rc.ray.origin;
      const d = rc.ray.direction;
      const t = Math.min(d.y < -1e-3 ? -o.y / d.y : 400, 400);
      return { x: o.x + d.x * t, z: o.z + d.z * t };
    });
    const buildingState = new Map<string, UiState>();
    for (const b of this.blds.values()) buildingState.set(b.m.code, b.state);
    this.mini.draw(this.C, {
      footprint,
      target: { x: this.controls.target.x, z: this.controls.target.z },
      focus: this.focusB,
      buildingState,
      incidents: this.incidents().map((i) => ({
        pos: (this.devs.get(i.device) as DevView).m.pos,
        severity: i.severity,
      })),
      blink: this.reduce ? 1 : 0.55 + 0.45 * Math.abs(Math.sin(now / 300)),
    });
  }

  private watchFps(now: number) {
    if (!this.fpsStart) {
      this.fpsStart = now + 6000; // let the fly-in and shader compile pass
      return;
    }
    if (now < this.fpsStart) return;
    this.fpsFrames += 1;
    const span = now - this.fpsStart;
    if (span < 5000) return;
    const fps = (this.fpsFrames * 1000) / span;
    this.fpsFrames = 0;
    this.fpsStart = now;
    this.fpsWindows += 1;
    this.cb.onFps?.(fps);
    if (this.autoEco && this.fpsWindows === 1 && fps < AUTO_ECO_FPS && !this.eco) {
      this.setEco(true);
      this.cb.onAutoEco?.(fps);
    }
  }

  private readonly tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (this.fly) {
      const f = this.fly;
      f.k = Math.min(1, f.k + (this.reduce ? 1 : dt * f.spd));
      const e = 1 - Math.pow(1 - f.k, 3);
      this.camera.position.lerpVectors(f.p0, f.p1, e);
      this.controls.target.lerpVectors(f.t0, f.t1, e);
      if (f.k >= 1) this.fly = null;
    }
    this.controls.update();
    this.animate(now, dt);
    this.syncInstances();
    this.drawMini(now);
    if (this.bloom) this.bloom.enabled = this.useBloom();
    if (this.useBloom() && this.composer) {
      try {
        this.composer.render();
      } catch {
        this.composer = null;
        this.renderer.render(this.scene, this.camera);
      }
    } else this.renderer.render(this.scene, this.camera);
    this.placeLabels();
    this.watchFps(now);
  };

  // ---------- picking ----------

  private bindPointer() {
    const el = this.renderer.domElement;
    let downAt: [number, number] | null = null;
    const down = (e: PointerEvent) => {
      downAt = [e.clientX, e.clientY];
      this.fly = null;
    };
    const up = (e: PointerEvent) => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
      const sel = this.pick(e.clientX, e.clientY, e.pointerType === 'touch' ? 32 : 20);
      this.select(sel, false);
      this.cb.onSelect?.(sel);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    this.cleanups.push(
      () => el.removeEventListener('pointerdown', down),
      () => el.removeEventListener('pointerup', up),
    );
  }

  private pick(clientX: number, clientY: number, radius: number): Selection | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, this.camera);
    const hit = ray.intersectObjects(this.pickables.filter((o) => o.visible))[0];
    if (hit) {
      const ud = hit.object.userData as { code?: string; lab?: string; ap?: boolean };
      if (ud.ap && hit.instanceId !== undefined) {
        const d = this.apList[hit.instanceId];
        if (d?.visible) return { kind: 'device', code: d.m.code };
      } else if (ud.code) return { kind: 'device', code: ud.code };
      else if (ud.lab) return { kind: 'lab', locCode: ud.lab };
    }
    // nothing hit: nearest device on screen within the radius (thin targets, touch)
    let best: string | null = null;
    let bd = radius;
    const pv = this.tmp.v;
    for (const d of this.devs.values()) {
      if (!d.visible) continue;
      pv.set(d.m.pos.x, d.m.pos.y, d.m.pos.z).project(this.camera);
      if (pv.z > 1) continue;
      const dd = Math.hypot(
        ((pv.x + 1) / 2) * r.width - (clientX - r.left),
        ((1 - pv.y) / 2) * r.height - (clientY - r.top),
      );
      if (dd < bd) {
        bd = dd;
        best = d.m.code;
      }
    }
    return best ? { kind: 'device', code: best } : null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
