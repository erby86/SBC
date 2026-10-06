import { describe, expect, it } from 'vitest';
import { LIFT, placeTags, type TagIn } from './labels.js';

const tag = (sx: number, sy: number, over: Partial<TagIn> = {}): TagIn => ({
  sx,
  sy,
  w: 80,
  h: 20,
  rank: 2,
  major: false,
  ...over,
});

describe('label placement', () => {
  it('a lone label sits just above its point with a short leader line', () => {
    const [a] = placeTags([tag(200, 300)], 800, 600);
    expect(a).toEqual({ hidden: false, x: 200, y: 300 - LIFT.minor, lead: LIFT.minor });
    const [b] = placeTags([tag(200, 300, { major: true })], 800, 600);
    expect(b?.lead).toBe(LIFT.major);
  });

  it('problems go first; the next one moves up 12 px at a time until it is clear', () => {
    const [quiet, problem] = placeTags(
      [tag(200, 300, { major: true, rank: 2 }), tag(205, 300, { major: true, rank: 0 })],
      800,
      600,
    );
    expect(problem?.y).toBe(300 - LIFT.major);
    // first free step: its bottom above the first label's top plus the 2 px gap
    expect(quiet?.y).toBe(300 - LIFT.major - 2 * LIFT.step);
    expect(quiet?.lead).toBe(LIFT.major + 2 * LIFT.step);
  });

  it('a quiet label with no room hides; a problem label moves beside its point instead', () => {
    // a wall of problem labels above the point
    const wall = Array.from({ length: 12 }, (_, k) =>
      tag(200, 300 - k * 22, { major: true, rank: 0 }),
    );
    const out = placeTags(
      [...wall, tag(200, 300, { rank: 3 }), tag(200, 300, { major: true, rank: 1 })],
      800,
      600,
    );
    expect(out[12]?.hidden).toBe(true);
    const side = out[13];
    expect(side?.hidden).toBe(false);
    expect(side?.x).not.toBe(200);
    expect(side?.lead).toBe(0);
    // grey "went out" names are major (lifted, tried beside) but give way when nothing is clear
    const crowd = placeTags(
      [
        ...wall,
        ...wall.map((t) => ({ ...t, sx: t.sx - 90 })),
        ...wall.map((t) => ({ ...t, sx: t.sx + 90 })),
      ],
      800,
      600,
    );
    expect(crowd.every((o) => !o.hidden)).toBe(true);
    const grey = placeTags(
      [
        ...wall,
        ...wall.map((t) => ({ ...t, sx: t.sx - 90 })),
        ...wall.map((t) => ({ ...t, sx: t.sx + 90 })),
        tag(200, 300, { major: true, keep: false, rank: 2 }),
      ],
      800,
      600,
    );
    expect(grey.at(-1)?.hidden).toBe(true);
  });

  it('keeps labels inside the box', () => {
    const [a] = placeTags([tag(10, 5, { major: true })], 800, 600);
    expect(a?.x).toBe(44);
    expect(a?.y).toBe(24);
  });

  it('area names hang under their point and give way', () => {
    const out = placeTags(
      [tag(200, 300, { major: true, rank: 0 }), tag(200, 270, { below: true, rank: 5 })],
      800,
      600,
    );
    expect(out[1]?.hidden).toBe(true);
  });

  it('a band over the top of the scene: labels stay below it, quiet ones under it hide', () => {
    const [problem, quiet] = placeTags(
      [tag(200, 40, { major: true, rank: 0, keep: true }), tag(500, 30, { rank: 4 })],
      800,
      600,
      80,
    );
    expect(problem?.hidden).toBe(false);
    expect((problem?.y ?? 0) - 20).toBeGreaterThanOrEqual(80);
    expect(quiet?.hidden).toBe(true);
  });
});
