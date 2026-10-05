// M20 search (prototype runSearch): one list of buildings, floors, rooms and devices from the layout,
// several words at once ("ap 8 เซียน 6", "nvr icet1", "ล่ม", an IP), forgiving about spaces and
// punctuation, grouped and ranked. Pure functions so the rules are tested without a browser.
import type { Layout, StatusSnapshot } from '@sbc-noc/shared';
import type { UiState } from '@sbc-noc/ui';
import { deviceKind, isComputerLab, type DeviceKind } from '../scene/model.js';

/** Lower case, no spaces/punctuation, no ฯ — "ห้องคอมฯ 8-เซียน" → "ห้องคอม8เซียน". */
export const norm = (s: string | null | undefined) =>
  (s ?? '')
    .toString()
    .toLowerCase()
    .replace(/[\s·()\-_,.]+/g, '')
    .replace(/ฯ/g, '');

/** What people call the buildings (prototype B_ALIAS), on top of the registry aliases. */
const B_ALIAS: Record<string, string> = {
  sp: 'อาคารกีฬา กีฬา sport sports gym ยิม',
  i2: 'icet2 ไอเซ็ต2 ไอเซท2',
  i1: 'icet1 ไอเซ็ต1 ไอเซท1',
  b1: 'อาคาร1 อ.1 อ1 ตึก1 b1',
  b2: 'อาคาร2 อ.2 อ2 ตึก2 b2 ห้องserver ห้องเซิร์ฟเวอร์',
  s8: '8เซียน แปดเซียน 8sian s8',
  ba: 'อาคารa อ.a ตึกa',
  bb: 'อาคารb อ.b ตึกb',
};
const T_WORD: Record<DeviceKind | 'other', string> = {
  ap: 'ap wifi ไวไฟ accesspoint แอคเซสพอยต์',
  nvr: 'nvr cctv กล้อง วงจรปิด',
  main: 'main เมน',
  access: 'switch สวิตช์ สวิตช์ชั้น',
  core: 'core router เราเตอร์ แกนกลาง server',
  wan: 'isp internet อินเทอร์เน็ต wan เน็ต',
  planned: 'controller วางแผน',
  other: '',
};
const S_WORD: Record<UiState, string> = {
  ok: 'ปกติ ok online',
  warn: 'เตือน warn warning',
  down: 'ล่ม down offline ดับ',
  cut: 'ขาด ขาดการเชื่อมต่อ cut unreachable',
  maint: 'บำรุงรักษา บำรุง maintenance',
};
const LAB_WORD = 'ห้องคอม lab computer คอมพิวเตอร์';

export type EntryKind = 'b' | 'f' | 'r' | 'd';
export interface SearchEntry {
  kind: EntryKind;
  /** Building code / "b#floor" / LOC code / device code. */
  id: string;
  building: string | null;
  floor: number | null;
  label: string;
  sub: string;
  /** Normalised words that match. */
  text: string;
  /** Normalised building words (for numbers like "8" in "8 เซียน"). */
  bw: string;
  ip: string | null;
  lab: boolean;
  /** Device layer (to switch it on when picked). */
  layer: string | null;
  isWan: boolean;
}

export function buildIndex(layout: Layout): SearchEntry[] {
  const out: SearchEntry[] = [];
  const bName = new Map(layout.buildings.map((b) => [b.code, b.name]));
  const bWords = new Map(
    layout.buildings.map((b) => [
      b.code,
      norm([b.name, b.nameEn, b.assetName, b.code, ...b.aliases, B_ALIAS[b.code] ?? ''].join(' ')),
    ]),
  );
  const where = (b: string | null, f: number | null) =>
    b ? `${bName.get(b) ?? b}${f ? ` ชั้น ${f}` : ''}` : '';
  for (const b of layout.buildings) {
    const bw = bWords.get(b.code) ?? '';
    const base = { building: b.code, bw, ip: null, lab: false, layer: null, isWan: false };
    out.push({
      ...base,
      kind: 'b',
      id: b.code,
      floor: null,
      label: b.name,
      sub: `${b.floorCount} ชั้น`,
      text: `${bw}อาคารตึก`,
    });
    for (let f = 1; f <= b.floorCount; f++) {
      out.push({
        ...base,
        kind: 'f',
        id: `${b.code}#${f}`,
        floor: f,
        label: `${b.name} ชั้น ${f}`,
        sub: 'เลือกชั้น',
        text: `${bw}ชั้น${f}`,
      });
    }
  }
  for (const l of layout.locations) {
    const lab = isComputerLab(l);
    const bw = bWords.get(l.building) ?? '';
    out.push({
      kind: 'r',
      id: l.locCode,
      building: l.building,
      floor: l.floor,
      label: l.roomNumber && !l.name.includes(l.roomNumber) ? `${l.name} ${l.roomNumber}` : l.name,
      sub: [l.locCode, where(l.building, l.floor)].filter(Boolean).join(' · '),
      text:
        norm(
          [l.name, l.locCode, l.roomNumber, `ชั้น${l.floor}`, 'ห้อง', lab ? LAB_WORD : ''].join(
            ' ',
          ),
        ) + bw,
      bw,
      ip: null,
      lab,
      layer: lab ? 'lab' : null,
      isWan: false,
    });
  }
  for (const d of layout.devices) {
    const kind = deviceKind(d) ?? 'other';
    const bw = d.building ? (bWords.get(d.building) ?? '') : '';
    const isWan = kind === 'wan';
    out.push({
      kind: 'd',
      id: d.code,
      building: d.building,
      floor: d.floor,
      label: isWan ? `อินเทอร์เน็ต ${d.name}` : d.name,
      sub: [where(d.building, d.floor) || (isWan ? 'อินเทอร์เน็ต' : 'ไม่มีตำแหน่ง'), d.ip, d.model]
        .filter(Boolean)
        .join(' · '),
      text:
        norm(
          [
            d.name,
            d.code,
            d.hostname,
            d.ip,
            d.model,
            d.role,
            d.locCode,
            T_WORD[kind],
            d.floor ? `ชั้น${d.floor}` : '',
          ].join(' '),
        ) + bw,
      bw,
      ip: d.ip,
      lab: false,
      layer:
        kind === 'other'
          ? null
          : kind === 'core' || kind === 'main' || kind === 'access'
            ? 'net'
            : kind,
      isWan,
    });
  }
  return out;
}

export type StateOf = (e: SearchEntry) => UiState | null;

/** State of an entry for status words and ranking: devices from the snapshot, others none. */
export function stateGetter(snap: StatusSnapshot | null): StateOf {
  return (e) => (e.kind === 'd' ? ((snap?.states[e.id] as UiState | undefined) ?? 'ok') : null);
}

function tokMatch(e: SearchEntry, t: string, stateOf: StateOf): boolean {
  // "a" / "b" alone = อาคาร A / B (prototype)
  if (/^[ab]$/.test(t)) return e.building === (t === 'a' ? 'ba' : 'bb');
  // a short number: the floor, or part of a building name ("8" → 8 เซียน)
  if (/^\d{1,3}$/.test(t)) return e.floor === Number(t) || e.bw.includes(t);
  const st = stateOf(e);
  if (st && norm(S_WORD[st]).includes(t)) return true;
  return e.text.includes(t) || (!!e.ip && e.ip.startsWith(t));
}

const GROUP: Record<EntryKind, number> = { b: 0, f: 1, r: 2, d: 3 };
export const GROUP_TH: Record<EntryKind, string> = {
  b: 'อาคาร',
  f: 'ชั้น',
  r: 'ห้อง',
  d: 'อุปกรณ์',
};

export function runSearch(index: SearchEntry[], q: string, stateOf: StateOf): SearchEntry[] {
  const toks = q.trim().toLowerCase().split(/\s+/).map(norm).filter(Boolean);
  if (!toks.length) return [];
  const nq = norm(q);
  return index
    .filter((e) => toks.every((t) => tokMatch(e, t, stateOf)))
    .map((e) => {
      let sc = 0;
      if (e.ip && e.ip === q.trim()) sc += 100;
      const nl = norm(e.label);
      if (nl.startsWith(nq)) sc += 40;
      if (nl === nq || norm(e.id) === nq) sc += 40;
      sc += e.kind === 'b' ? 30 : e.kind === 'f' ? 15 : 0;
      const st = stateOf(e);
      if (st === 'down') sc += 6;
      if (st === 'warn') sc += 4;
      return { e, sc };
    })
    .sort((a, b) => GROUP[a.e.kind] - GROUP[b.e.kind] || b.sc - a.sc)
    .map((r) => r.e);
}

export const QUICK = ['ล่ม', 'เตือน', 'ap ล่ม', 'nvr', 'main', 'ห้องคอม'];

const RECENT_KEY = 'noc-recent';
export function loadRecent(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}
export function saveRecent(q: string, list: string[]): string[] {
  const next = [q, ...list.filter((x) => x !== q)].slice(0, 5);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  return next;
}
