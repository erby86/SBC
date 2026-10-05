// Colours of the 3D scene come from the same CSS tokens as the panels (packages/ui/tokens.css),
// so dark/light theme switches both together.
import { Color } from 'three';

export const PALETTE_KEYS = [
  'bg',
  'ground',
  'grid',
  'slab',
  'edge',
  'ink-2',
  'core',
  'main',
  'access',
  'lab',
  'nvr',
  'wan',
  'ap',
  'planned',
  'down',
  'muted',
  'warn',
] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type Palette = Record<PaletteKey, Color>;

/** Fallback when a token is missing (tests, broken CSS): the dark prototype values. */
const FALLBACK: Record<PaletteKey, string> = {
  bg: '#0c1522',
  ground: '#101d2e',
  grid: '#1b2c43',
  slab: '#1d3048',
  edge: '#5f86ad',
  'ink-2': '#9db0c6',
  core: '#f2c14e',
  main: '#47d6a4',
  access: '#6fb6ff',
  lab: '#b9a7ff',
  nvr: '#ef7fc4',
  wan: '#58c8f0',
  ap: '#c6e86b',
  planned: '#7d8ca0',
  down: '#ff5b6b',
  muted: '#4a5a6e',
  warn: '#ffc23d',
};

export function readPalette(el: Element = document.documentElement): Palette {
  const style = getComputedStyle(el);
  const out = {} as Palette;
  for (const k of PALETTE_KEYS) {
    const v = style.getPropertyValue(`--${k}`).trim();
    const c = new Color();
    try {
      c.setStyle(v || FALLBACK[k]);
    } catch {
      c.setStyle(FALLBACK[k]);
    }
    out[k] = c;
  }
  return out;
}

/** Dark background → bloom and additive glow (prototype isDark). */
export function isDark(p: Palette): boolean {
  const hsl = { h: 0, s: 0, l: 0 };
  p.bg.getHSL(hsl);
  return hsl.l < 0.3;
}

export const rgba = (c: Color, a: number) => {
  const s = c.clone().convertLinearToSRGB();
  return `rgba(${Math.round(s.r * 255)},${Math.round(s.g * 255)},${Math.round(s.b * 255)},${a})`;
};
