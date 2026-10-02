// Pure mapping from the seed files (infra/seed) to schema v1.1 values. No database access here.

export interface VlanRef {
  vid: number;
  name: string | null;
  planned: boolean;
}

/** "60" → [60]; "103 / 104" → [103, 104]; "98 (วางแผน)" → planned; "100 (Admin + Academic)" → named. */
export function parseVlans(raw: string): VlanRef[] {
  const text = raw.trim();
  if (!text) return [];
  const note = /\(([^)]*)\)/.exec(text)?.[1]?.trim() ?? null;
  const planned = note === 'วางแผน';
  const vids = [...text.replace(/\([^)]*\)/g, '').matchAll(/\d+/g)].map((m) => Number(m[0]));
  return vids.map((vid) => ({ vid, planned, name: planned ? null : note }));
}

const MEDIA: Record<string, string> = {
  ไฟเบอร์: 'fiber',
  LAN: 'copper',
  'LACP 4x1G': 'lacp',
  trunk: 'trunk',
  PPPoE: 'pppoe',
  วางแผน: 'planned',
};

/** Link media code (net.link_media) for the "ชนิดสาย" column. */
export function mediaCode(raw: string): string {
  const code = MEDIA[raw.trim()];
  if (!code) throw new Error(`unknown link type "${raw}"`);
  return code;
}

const FORMS: Record<string, string> = {
  ห้องแถวเดียวมีทางเดิน: 'single_loaded',
  ห้องสองฝั่งทางเดินกลาง: 'double_loaded',
  ล้อมลานกลาง: 'courtyard',
  'โถง/โดม': 'hall',
  พื้นที่โล่ง: 'open_area',
};

export function buildingForm(raw: string): string | null {
  return raw.trim() ? (FORMS[raw.trim()] ?? null) : null;
}

const LOCATION_TYPES: Record<string, string> = {
  'ห้อง server / rack': 'server_room',
  ห้องคอมพิวเตอร์: 'computer_lab',
  ห้องเรียน: 'classroom',
  สำนักงาน: 'office',
};

export function locationType(raw: string): string | null {
  return raw.trim() ? (LOCATION_TYPES[raw.trim()] ?? 'other') : null;
}

/** "สถานะข้อมูล" → lifecycle + data_status on net.devices. */
export function deviceStatus(raw: string): { lifecycle: string; dataStatus: string } {
  switch (raw.trim()) {
    case 'วางแผน':
      return { lifecycle: 'planned', dataStatus: 'unverified' };
    case 'ตัวอย่าง':
      // Sample row from the prototype (ADR-0014): kept visible for M07 but never treated as real.
      return { lifecycle: 'planned', dataStatus: 'sample' };
    default:
      return { lifecycle: 'active', dataStatus: 'unverified' };
  }
}

/** Placeholder text in "รุ่น" that is a description, not a catalog model. */
const GENERIC_MODELS = new Set(['สวิตช์ประจำชั้น', 'สวิตช์ main', 'จุดรับไฟเบอร์']);

export function modelOf(raw: string): { name: string; kind: string } | null {
  const name = raw.trim();
  if (!name || GENERIC_MODELS.has(name)) return null;
  const kind = /CCR|ER8411/i.test(name)
    ? 'router'
    : /controller/i.test(name)
      ? 'controller'
      : /NVR/i.test(name)
        ? 'nvr'
        : /\bAP\b/.test(name)
          ? 'ap'
          : 'switch';
  return { name, kind };
}

/** Fiber cable label per ADR-0006: FO-<from building>-<to building>-<NN>. */
export function fiberCode(fromBuilding: string, toBuilding: string, seq: number): string {
  return `FO-${fromBuilding.toUpperCase()}-${toBuilding.toUpperCase()}-${String(seq).padStart(2, '0')}`;
}

export const toInt = (raw: string): number | null => (raw.trim() === '' ? null : Number(raw));
export const orNull = (raw: string): string | null => (raw.trim() === '' ? null : raw.trim());
