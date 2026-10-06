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
import { placeTags, type TagIn } from './labels.js';
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

// home view direction (and the view before the layout is loaded); the distance and centre are
// fitted to the buildings and the card size (homeView)
const HOME = { pos: new THREE.Vector3(-49, 56, 80), tgt: new THREE.Vector3(0, 2, 20) };
/** Motion standard (canvas "มาตรฐานหน้าจอ NOC"): packets are the only thing that loops, one per
 * link, released together every 2.4 s (4.8 s on a weak link, none when cut off or behind a root
 * cause); the camera moves only when someone asks, in 0.9 s; selecting a problem ripples twice. */
const MOTION = { packetMs: 2400, weakPacketMs: 4800, cameraS: 0.9, rippleMs: 1500, ripples: 2 };
/** Room kept around the school in the home view (NDC): labels sit above the roofs. */
const FIT = { x: 0.9, top: 0.72, bottom: -0.9 };
const AUTO_ECO_FPS = 24;
const EMISSIVE = 0.35;
/** Wireframe buildings: bright outlines and floor lines, near-clear slabs and glass. */
// floor lines and glass mullions stay faint so outlines, devices and cables read first
const WIRE = { edge: 0.95, floor: 0.3, slab: 0.06, fill: 0.03, mull: 0.05, shadow: 0.5 };
/** Floor lines of the building in focus: brighter, so the selected building stands out. */
const FOCUS_FLOOR = 0.6;

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
  /** A problem building's label: lifted out of the way first. */
  major?: () => boolean;
  /** Never hidden (red and amber buildings). */
  keep?: () => boolean;
}

interface Fx {
  severity: 'down' | 'warn';
  ring: THREE.Mesh;
  beam: THREE.Mesh | null;
  code: string;
  /** When the selection ripple started (0 = none); it runs MOTION.ripples times, then stops. */
  rippleAt: number;
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
  /** Camera is on (or flying to) the home view: it follows the card size until someone moves it. */
  private atHome = true;
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
  private fpsLast = 0;
  private topInset = 0;
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
    this.controls.addEventListener('start', () => (this.atHome = false));

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
      // the composer draws into its own target, where the canvas' antialias does not apply:
      // multisample that target or edges and thin cables come out jagged and soft
      // (logical size: the composer multiplies by the pixel ratio itself, setSize follows on resize)
      const size = this.renderer.getSize(new THREE.Vector2());
      const target = new THREE.WebGLRenderTarget(size.x, size.y, {
        type: THREE.HalfFloatType,
        samples: 4,
      });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // tight, soft glow: a wide radius smears thin cables and building edges
      this.bloom = new UnrealBloomPass(new THREE.Vector2(800, 600), 0.3, 0.15, 0.65);
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
    // no fly-in: the camera moves only when someone asks (motion standard)
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
    this.refitHome();
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
      this.flyHome();
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
      const f = this.fx.get(sel.code);
      if (f) f.rippleAt = performance.now();
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
    else this.flyHome();
  }

  /** Pixels at the top of the scene covered by a band (the not-live band): labels stay below. */
  setTopInset(px: number): void {
    this.topInset = Math.max(0, Math.round(px));
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

  /** Eco saves by dropping bloom and the tails; it keeps the screen's own resolution (capped at
   * 1.5) because a canvas drawn at 1 and stretched by the browser looks blurry on 125 %+ screens. */
  private pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.eco ? 1.5 : 2);
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
    m.opacity = 0.2; // ground grid as a quiet reference, not a pattern
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
    el.innerHTML = `<span class="lt">${html}</span>`;
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
      label.major = () => view.state !== 'ok' && view.state !== 'maint';
      label.keep = () => view.state === 'down' || view.state === 'warn';
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
        for (let i = 0; i < 1; i++) {
          const back = false;
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
            t: 0,
            dir: 1,
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
          speed: 0,
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
      const n = planned ? 0 : 1;
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
        speed: 0,
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
      // problems glow a little brighter, steadily (no pulsing)
      d.mat.emissiveIntensity = d.state === 'down' ? 0.9 : d.state === 'warn' ? 0.7 : EMISSIVE;
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
      let out = 0;
      for (const d of this.devs.values()) {
        if (d.m.building !== b.m.code || d.m.kind === 'planned') continue;
        if (d.state === 'cut') out += 1;
        if (d.state === 'down') st = 'down';
        else if (d.state === 'cut' && st !== 'down') st = 'cut';
        else if (d.state === 'warn' && st !== 'down' && st !== 'cut') st = 'warn';
        else if (d.state === 'maint' && st === 'ok') st = 'maint';
      }
      b.state = st;
      b.ring.className = `ring ${st}`;
      // a building without a problem gets a small plain name (declutter); problems stand out
      b.label.classList.toggle('quiet', st === 'ok' || st === 'maint');
      b.label.classList.toggle('cut', st === 'cut');
      const small = b.label.querySelector('small');
      if (small) small.textContent = st === 'cut' ? `ดับตาม ${out}` : `${b.m.floors} ชั้น`;
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
    incs.forEach((i) => {
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
      this.fx.set(i.device, { severity: i.severity, ring, beam, code: i.device, rippleAt: 0 });
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
      // text in an inner span: it carries the ellipsis, the badge carries the leader line
      if (!el.firstElementChild) el.appendChild(document.createElement('span'));
      (el.firstElementChild as HTMLSpanElement).textContent =
        `${STATE_ICON[i.severity]} ${d.m.name}`;
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
      b.floorMat.opacity = dim ? 0.08 : focus ? FOCUS_FLOOR : WIRE.floor;
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

  /** Home camera: same direction as HOME, centred on the school and as close as it can be with
   * every building (roofs included) inside the card. Fitted by bisection on the distance. */
  private homeView(): { pos: THREE.Vector3; tgt: THREE.Vector3 } {
    const m = this.model;
    if (!m?.buildings.length) return { pos: HOME.pos.clone(), tgt: HOME.tgt.clone() };
    const b = m.bounds;
    const tgt = new THREE.Vector3((b.x0 + b.x1) / 2, 2, (b.z0 + b.z1) / 2);
    const dir = HOME.pos.clone().sub(HOME.tgt).normalize();
    const cam = this.camera.clone();
    cam.updateProjectionMatrix();
    // every building corner at the ground and at its own roof; open areas (dome, field, pool,
    // playground) stay out so the buildings, where the devices are, fill the card
    const pts: THREE.Vector3[] = [];
    const corners = (
      r: { x: number; z: number; width: number; depth: number; rotation: number },
      ys: number[],
    ) => {
      const c = Math.cos(r.rotation);
      const sn = Math.sin(r.rotation);
      for (const [u, w] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        const dx = (u * r.width) / 2;
        const dz = (w * r.depth) / 2;
        for (const y of ys)
          pts.push(new THREE.Vector3(r.x + dx * c - dz * sn, y, r.z + dx * sn + dz * c));
      }
    };
    for (const x of m.buildings) corners(x, [0, x.floors * x.floorHeight + 1]);
    const v = new THREE.Vector3();
    const place = (d: number) => {
      cam.position.copy(tgt).addScaledVector(dir, d);
      cam.lookAt(tgt);
      cam.updateMatrixWorld();
    };
    const fits = (d: number) => {
      place(d);
      return pts.every((p) => {
        v.copy(p).project(cam);
        return v.z < 1 && Math.abs(v.x) <= FIT.x && v.y <= FIT.top && v.y >= FIT.bottom;
      });
    };
    const nearest = () => {
      let lo = this.controls.minDistance;
      let hi = this.controls.maxDistance;
      if (!fits(hi)) return hi;
      for (let k = 0; k < 20 && hi - lo > 0.25; k++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    };
    // perspective puts the near side lower than the far side: centre what is seen, then refit
    let hi = nearest();
    for (let round = 0; round < 2; round++) {
      place(hi);
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const p of pts) {
        v.copy(p).project(cam);
        x0 = Math.min(x0, v.x);
        x1 = Math.max(x1, v.x);
        y0 = Math.min(y0, v.y);
        y1 = Math.max(y1, v.y);
      }
      const halfH = hi * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      tgt.addScaledVector(right, ((x0 + x1) / 2) * halfH * cam.aspect);
      tgt.addScaledVector(up, ((y0 + y1) / 2 - (FIT.top + FIT.bottom) / 2) * halfH);
      hi = nearest();
    }
    return { pos: tgt.clone().addScaledVector(dir, hi), tgt };
  }

  private flyHome() {
    const h = this.homeView();
    this.flyTo(h.pos, h.tgt);
    this.atHome = true;
  }

  /** The card or the layout changed: keep the home view fitted unless someone moved the camera. */
  private refitHome() {
    if (!this.atHome) return;
    const h = this.homeView();
    if (this.fly) {
      this.fly.p1 = h.pos;
      this.fly.t1 = h.tgt;
    } else {
      this.camera.position.copy(h.pos);
      this.controls.target.copy(h.tgt);
    }
  }

  private flyTo(pos: THREE.Vector3, tgt: THREE.Vector3) {
    this.atHome = false;
    this.fly = {
      p0: this.camera.position.clone(),
      t0: this.controls.target.clone(),
      p1: pos,
      t1: tgt,
      k: 0,
      spd: 1 / MOTION.cameraS,
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
    this.refitHome();
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

  private animate(now: number) {
    if (!this.reduce && !this.still) {
      // one packet per link, all released from the core side at the same moment
      for (const l of this.links) {
        const weak = l.state === 'warn';
        const on = l.visible && (l.state === 'ok' || weak);
        const t =
          (now % (weak ? MOTION.weakPacketMs : MOTION.packetMs)) /
          (weak ? MOTION.weakPacketMs : MOTION.packetMs);
        for (const d of l.dots) {
          d.mesh.visible = on;
          if (!on) {
            for (const tl of d.tail) tl.visible = false;
            continue;
          }
          d.t = t;
          l.curve.getPoint(t, d.mesh.position);
          for (const tl of d.tail) {
            tl.visible = !this.eco;
            if (tl.visible) l.curve.getPoint(Math.max(0, t - (tl.j * 0.5) / l.len), tl.pos);
          }
        }
      }
    } else {
      for (const l of this.links)
        for (const d of l.dots) {
          d.mesh.visible = false;
          for (const tl of d.tail) tl.visible = false;
        }
    }
    // problem marks stand still; a selected one ripples twice, then rests
    for (const f of this.fx.values()) {
      const vis = this.devs.get(f.code)?.visible ?? false;
      const k = f.rippleAt ? (now - f.rippleAt) / MOTION.rippleMs : MOTION.ripples;
      const rippling = !this.reduce && k >= 0 && k < MOTION.ripples;
      const fr = rippling ? k % 1 : 0;
      f.ring.visible = vis;
      f.ring.scale.setScalar(rippling ? 1 + fr * (f.severity === 'down' ? 6 : 3.5) : 1.6);
      (f.ring.material as THREE.MeshBasicMaterial).opacity = rippling ? 0.65 * (1 - fr) : 0.5;
      if (f.beam) {
        f.beam.visible = vis;
        (f.beam.material as THREE.MeshBasicMaterial).opacity = 0.3;
      }
    }
  }

  private placeLabels() {
    const W = this.opts.container.clientWidth;
    const Hh = this.opts.container.clientHeight;
    const v = this.tmp.v;
    const els: HTMLElement[] = [];
    const tags: TagIn[] = [];
    // problem badges (down before warn), then problem buildings, then the quiet names
    for (const [code, el] of this.badges) {
      const d = this.devs.get(code);
      if (!d) continue;
      v.set(d.m.pos.x, d.m.pos.y + 1.3, d.m.pos.z).project(this.camera);
      if (v.z > 1 || !d.visible) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'block';
      els.push(el);
      tags.push({
        sx: ((v.x + 1) / 2) * W,
        sy: ((1 - v.y) / 2) * Hh,
        w: el.offsetWidth || 90,
        h: el.offsetHeight || 20,
        rank: el.classList.contains('down') ? 0 : 1,
        major: true,
      });
    }
    for (const l of this.labelsList) {
      v.copy(l.pos).project(this.camera);
      // open areas (dome, field, pool, playground) are named only once someone moves in:
      // at the whole-school view their names sit among the buildings and read as clutter
      if (
        v.z > 1 ||
        (!!l.device && this.badges.has(l.device)) ||
        (this.atHome && l.el.classList.contains('area'))
      ) {
        l.el.style.visibility = 'hidden';
        continue;
      }
      const major = l.major?.() ?? false;
      els.push(l.el);
      tags.push({
        sx: ((v.x + 1) / 2) * W,
        sy: ((1 - v.y) / 2) * Hh,
        w: l.w || (l.w = l.el.offsetWidth || 80),
        h: l.h || (l.h = l.el.offsetHeight || 20),
        // red/amber buildings, then grey ones, then quiet names
        rank: l.keep?.() ? 2 : major ? 2.5 : 3 + l.prio(),
        major,
        keep: l.keep?.() ?? false,
        below: l.below,
      });
    }
    placeTags(tags, W, Hh, this.topInset).forEach((o, k) => {
      const el = els[k] as HTMLElement;
      el.style.visibility = o.hidden ? 'hidden' : 'visible';
      if (o.hidden) return;
      el.style.left = `${o.x}px`;
      el.style.top = `${o.y}px`;
      el.style.setProperty('--lead', `${o.lead}px`);
    });
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
      blink: 1,
    });
  }

  private watchFps(now: number) {
    if (!this.fpsStart) {
      this.fpsStart = now + 6000; // let the fly-in and shader compile pass
      return;
    }
    if (now < this.fpsStart) return;
    // a hidden tab or a stalled frame loop is not a slow GPU: start the window again
    if (document.hidden || now - this.fpsLast > 1000) {
      this.fpsLast = now;
      this.fpsFrames = 0;
      this.fpsStart = now;
      return;
    }
    this.fpsLast = now;
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
    this.animate(now);
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
      this.atHome = false;
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
