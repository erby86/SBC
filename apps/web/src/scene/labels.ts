// Label placement over the 3D view (canvas "SBC NOC Console"): problems first; each label starts
// a little above its point and moves up a step at a time until it is clear, with a leader line
// down to the point. A problem label still in the way then tries beside its point (no leader);
// quiet labels that stay in the way hide; red and amber problem labels never hide. Area names sit under their
// point and simply give way. Pure, so the rules are tested without a browser.

export const LIFT = { major: 18, minor: 8, step: 12, tries: 9 };
const SIDES = [0, -0.6, 0.6, -1.2, 1.2];

export interface TagIn {
  /** Screen point the label belongs to. */
  sx: number;
  sy: number;
  w: number;
  h: number;
  /** Order: lower goes first and wins the space. */
  rank: number;
  major: boolean;
  /** Placed even when nowhere is clear (default: `major`). Grey "went out with a root cause"
   * names are major but may hide: the root-cause card lists them. */
  keep?: boolean;
  /** Hangs under its point (open areas) instead of above it. */
  below?: boolean;
}

export interface TagOut {
  hidden: boolean;
  /** Label anchor: centre x, and its bottom edge (top edge for `below`). */
  x: number;
  y: number;
  /** Leader line length down to the point (0 = none). */
  lead: number;
}

type Rect = [number, number, number, number];

/** Places the tags in a W×H box; the result is in input order. */
export function placeTags(
  tags: readonly TagIn[],
  W: number,
  H: number,
  /** Height kept clear at the top (a band over the scene); tags stay below it. */
  top = 0,
): TagOut[] {
  const placed: Rect[] = top > 0 ? [[0, -1000, W, 1000 + top]] : [];
  const overlaps = (r: Rect) =>
    placed.some(
      (p) =>
        r[0] < p[0] + p[2] + 4 &&
        r[0] + r[2] + 4 > p[0] &&
        r[1] < p[1] + p[3] + 2 &&
        r[1] + r[3] + 2 > p[1],
    );
  const out: TagOut[] = tags.map(() => ({ hidden: true, x: 0, y: 0, lead: 0 }));
  const order = tags
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.rank - b.t.rank || a.t.sy - b.t.sy);
  for (const { t, i } of order) {
    const { w, h } = t;
    // a quiet name whose point is under the band has nothing to point at
    if (t.sy < top && !(t.keep ?? t.major)) continue;
    const clampX = (cx: number) => Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, cx));
    const clampY = (cy: number) => Math.max(top + h + 4, Math.min(H - 4, cy));
    if (t.below) {
      const x = clampX(t.sx);
      const y = Math.max(top + 4, Math.min(H - h - 4, t.sy));
      const r: Rect = [x - w / 2, y, w, h];
      if (overlaps(r)) continue;
      placed.push(r);
      out[i] = { hidden: false, x, y, lead: 0 };
      continue;
    }
    let spot: { x: number; y: number; side: boolean } | null = null;
    for (const f of t.major ? SIDES : [0]) {
      const cx = clampX(t.sx + f * w);
      for (let k = 0, lift = t.major ? LIFT.major : LIFT.minor; k < LIFT.tries; k++) {
        const cy = clampY(t.sy - lift);
        if (!overlaps([cx - w / 2, cy - h, w, h])) {
          spot = { x: cx, y: cy, side: f !== 0 };
          break;
        }
        lift += LIFT.step;
      }
      if (spot) break;
    }
    if (!spot && !(t.keep ?? t.major)) continue;
    spot ??= {
      x: clampX(t.sx),
      y: clampY(t.sy - LIFT.major - LIFT.step * (LIFT.tries - 1)),
      side: false,
    };
    placed.push([spot.x - w / 2, spot.y - h, w, h]);
    out[i] = {
      hidden: false,
      x: spot.x,
      y: spot.y,
      lead: spot.side ? 0 : Math.max(0, Math.round(t.sy - spot.y)),
    };
  }
  return out;
}
