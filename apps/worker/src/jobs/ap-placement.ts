// Where an access point is: building + floor from its name, else from the floor switch it is
// cabled to. Shared by all controller imports (UniFi, Omada, ...) — M06.
/** AP name → building + floor (+ number on the floor). Named groups b (building), f, n. First match wins. */
export const NAME_RULES: { re: RegExp; building?: string }[] = [
  // Uniform name for any building, free text allowed after it: "SP-3-1 Canteen", "BB-1-1 ITB"
  { re: /^(?<b>sp|i2|i1|b1|b2|s8|ba|bb)-(?<f>\d{1,2})-(?<n>\d+)(?:\s.*)?$/i },
  { re: /^8SFL(?<f>\d{1,2})-(?<n>\d+)$/i, building: 's8' }, // 8SFL2-1 = 8 เซียน ชั้น 2 ตัวที่ 1
  { re: /^AF?(?<f>\d{1,2})-(?<n>\d+)$/i, building: 'ba' }, // A6-1, AF2-1201 = อาคาร A
  { re: /^BF?L?(?<f>\d{1,2})-(?<n>\d+)$/i, building: 'bb' }, // BFL3-1, BF5-2 = อาคาร B
  { re: /^UAP-AC-(?<f>\d{1,2})AP(?<n>\d+)F$/i, building: 'ba' }, // UAP-AC-7AP1F = อาคาร A ชั้น 7 ตัวที่ 1
];

/**
 * Switches that serve only their own floor: an AP with no usable name takes the switch's floor.
 * Not the building main switches (e.g. US24AFL-4 = m-a4), whose cables run to several floors.
 */
export const FLOOR_SWITCH_RULES: { re: RegExp; building: string }[] = [
  { re: /^US\d+BFL-(?<f>\d{1,2})$/i, building: 'bb' }, // US16BFL-4 = อาคาร B ชั้น 4
];

export interface ApPlace {
  building: string;
  floor: number;
  no: string;
  from: 'name' | 'uplink';
}

function match(
  rules: { re: RegExp; building?: string }[],
  name: string,
): { building: string; floor: number; n?: string | undefined } | null {
  for (const { re, building } of rules) {
    const g = re.exec(name.trim())?.groups;
    const b = building ?? g?.['b']?.toLowerCase();
    if (g && b) return { building: b, floor: Number(g['f']), n: g['n'] };
  }
  return null;
}

export function parseApName(name: string): ApPlace | null {
  const m = match(NAME_RULES, name);
  return m && { building: m.building, floor: m.floor, no: String(Number(m.n ?? 1)), from: 'name' };
}

/** Name first, then the floor switch the AP is cabled to (number = switch port). */
export function placeAp(
  ap: { name: string; uplinkMac: string | null; uplinkPort: number | null },
  nameByMac: Map<string, string>,
): ApPlace | null {
  const byName = parseApName(ap.name);
  if (byName) return byName;
  const sw = ap.uplinkMac ? nameByMac.get(ap.uplinkMac) : undefined;
  const m = sw ? match(FLOOR_SWITCH_RULES, sw) : null;
  return (
    m && { building: m.building, floor: m.floor, no: `p${ap.uplinkPort ?? 0}`, from: 'uplink' }
  );
}

export function apCode(p: Pick<ApPlace, 'building' | 'floor' | 'no'>): string {
  return `ap-${p.building}-${p.floor}-${p.no}`;
}
