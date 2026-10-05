// Mini map of the prototype: buildings coloured by their worst state, the ground area the camera
// sees, the viewing direction, incident symbols and north. Plain 2D canvas, redrawn ≤ 7 × / s.
import type { UiState } from '@sbc-noc/ui';
import type { SceneModel, Vec3 } from './model.js';
import { rgba, type Palette } from './palette.js';

export interface MiniView {
  /** Ground points of the four screen corners (camera footprint) and the orbit target. */
  footprint: { x: number; z: number }[];
  target: { x: number; z: number };
  focus: string | null;
  buildingState: Map<string, UiState>;
  incidents: { pos: Vec3; severity: 'down' | 'warn' }[];
  blink: number;
}

/** Short names on the map; long ones are cut so labels stay inside small buildings. */
const abbr = (name: string) =>
  name
    .replace(/^อาคาร\s*/, 'อ.')
    .replace(/^อ\.([A-Za-z])$/, '$1')
    .slice(0, 7);

export class MiniMap {
  private scale = 1;
  private ox = 0;
  private oz = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly model: SceneModel,
  ) {}

  /** World ground point under a click on the map. */
  toWorld(clientX: number, clientY: number): { x: number; z: number } {
    const r = this.canvas.getBoundingClientRect();
    const { x0, z0 } = this.model.bounds;
    return {
      x: (clientX - r.left - this.ox) / this.scale + x0,
      z: (clientY - r.top - this.oz) / this.scale + z0,
    };
  }

  draw(C: Palette, v: MiniView): void {
    const g = this.canvas.getContext('2d');
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (!g || !cw || !ch) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(cw * dpr)) {
      this.canvas.width = Math.round(cw * dpr);
      this.canvas.height = Math.round(ch * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const { x0, x1, z0, z1 } = this.model.bounds;
    const pad = 8;
    this.scale = Math.min((cw - pad * 2) / (x1 - x0), (ch - pad * 2) / (z1 - z0));
    this.ox = (cw - (x1 - x0) * this.scale) / 2;
    this.oz = (ch - (z1 - z0) * this.scale) / 2;
    const w2m = (x: number, z: number): [number, number] => [
      this.ox + (x - x0) * this.scale,
      this.oz + (z - z0) * this.scale,
    ];
    const font = '"Noto Sans Thai Variable", Tahoma, sans-serif';

    const shapes = [
      ...this.model.areas
        .filter((a) => a.kind !== 'pool' && a.kind !== 'field')
        .map((a) => ({ ...a, area: true })),
      ...this.model.buildings.map((b) => ({ ...b, area: false })),
    ];
    for (const b of shapes) {
      const c = Math.cos(b.rotation);
      const s = Math.sin(b.rotation);
      const pts = (
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ] as const
      ).map(([u, w]) =>
        w2m(
          b.x + ((u * b.width) / 2) * c - ((w * b.depth) / 2) * s,
          b.z + ((u * b.width) / 2) * s + ((w * b.depth) / 2) * c,
        ),
      );
      const st = b.area ? null : v.buildingState.get(b.code);
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fillStyle =
        st === 'down'
          ? rgba(C.down, 0.6)
          : st === 'warn'
            ? rgba(C.warn, 0.55)
            : st === 'maint'
              ? rgba(C.planned, 0.4)
              : rgba(C.edge, b.area ? 0.08 : 0.22);
      g.fill();
      const focused = v.focus === b.code;
      g.lineWidth = focused ? 2 : 1;
      g.strokeStyle = focused ? rgba(C.wan, 1) : rgba(C.edge, 0.7);
      g.stroke();
    }

    g.font = `600 9px ${font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const b of this.model.buildings) {
      const [x, y] = w2m(b.x, b.z);
      const t = abbr(b.name);
      const tw = g.measureText(t).width;
      g.fillStyle = rgba(C.bg, 0.55);
      g.fillRect(x - tw / 2 - 2, y - 6, tw + 4, 12);
      const st = v.buildingState.get(b.code);
      g.fillStyle = rgba(st === 'down' ? C.down : st === 'warn' ? C.warn : C.edge, 1);
      g.fillText(t, x, y);
    }

    // what the camera sees
    const fp = v.footprint.map((p) => w2m(p.x, p.z));
    g.save();
    g.beginPath();
    g.rect(0, 0, cw, ch);
    g.clip();
    g.beginPath();
    fp.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = rgba(C.wan, 0.14);
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = rgba(C.wan, 0.95);
    g.stroke();
    // arrow from the near edge of the footprint towards the target
    const [tx, ty] = w2m(v.target.x, v.target.z);
    const [p0, p1] = fp;
    if (p0 && p1) {
      const bx = (p0[0] + p1[0]) / 2;
      const by = (p0[1] + p1[1]) / 2;
      const ang = Math.atan2(ty - by, tx - bx);
      g.translate(Math.max(8, Math.min(cw - 8, tx)), Math.max(8, Math.min(ch - 8, ty)));
      g.rotate(ang);
      g.beginPath();
      g.moveTo(7, 0);
      g.lineTo(-5, -5);
      g.lineTo(-2, 0);
      g.lineTo(-5, 5);
      g.closePath();
      g.fillStyle = rgba(C.wan, 1);
      g.fill();
    }
    g.restore();

    // incidents, same symbols as the rest of the page
    g.font = `700 12px ${font}`;
    for (const i of v.incidents) {
      const [x, y] = w2m(i.pos.x, i.pos.z);
      g.fillStyle = rgba(C.bg, 0.8);
      g.beginPath();
      g.arc(x, y, 6.5, 0, 7);
      g.fill();
      g.fillStyle = rgba(
        i.severity === 'down' ? C.down : C.warn,
        i.severity === 'down' ? v.blink : 1,
      );
      g.fillText(i.severity === 'down' ? '✕' : '▲', x, y + 0.5);
    }

    // north
    g.save();
    g.translate(cw - 12, 14);
    g.fillStyle = rgba(C['ink-2'], 1);
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(4, 2);
    g.lineTo(0, 0);
    g.lineTo(-4, 2);
    g.closePath();
    g.fill();
    g.font = `600 9px ${font}`;
    g.fillText('N', 0, 9);
    g.restore();
  }
}
