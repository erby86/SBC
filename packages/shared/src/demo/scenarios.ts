// The prototype scenarios (+ storm, root-cause grouping) (docs/prototype/sb-noc-3d-baseline-v3.html, loadScenario) as fixtures
// (M38, ADR-0014). Times are minutes before "now" so a scenario can be replayed at any moment.
// Used by: status-engine tests (M15), the demo mode of the api/web (dev/staging/admins only), e2e.
import type { StatusInput } from '../status.js';

export const DEMO_LABEL = 'ข้อมูลสาธิต — ไม่ใช่สถานะจริง';

export interface DemoScenario {
  name: string;
  title: string;
  description: string;
  /** Minutes since the last data refresh (stale scenario: 6). */
  lastUpdateMin: number;
  signals: { device: string; severity: 'down' | 'warn'; sinceMin: number; message: string }[];
  acks: { device: string; by: string; note: string; atMin: number }[];
  maintenance: { device: string; message: string; by: string }[];
  /** PCs online per lab (LOC); rooms not listed are full (registry count). */
  labOnline: Record<string, number>;
  /** Zabbix hosts with no registry position (M08 unmatched_host), shown in "ไม่มีตำแหน่ง". */
  unlocated: { name: string; ip: string; state: 'ok' | 'down'; group: string }[];
  /** Resolved events of the last 24 h for the history panel. */
  history: {
    device: string;
    severity: 'down' | 'warn';
    startMin: number;
    endMin: number;
    message: string;
  }[];
}

const MIXED_SIGNALS: DemoScenario['signals'] = [
  { device: 'ap-s8-6-1', severity: 'down', sinceMin: 12, message: 'ไม่ตอบ ping' },
  { device: 'nvr-i1-1', severity: 'down', sinceMin: 47, message: 'ไม่ตอบ ping' },
  {
    device: 'm-a1',
    severity: 'warn',
    sinceMin: 6,
    message: 'ไฟเบอร์ latency 38 ms (ปกติต่ำกว่า 2 ms)',
  },
  { device: 'wan1', severity: 'warn', sinceMin: 15, message: 'packet loss 4%' },
];
const MIXED_ACKS: DemoScenario['acks'] = [
  { device: 'nvr-i1-1', by: 'STF-03', note: 'รอเปลี่ยนอะแดปเตอร์', atMin: 30 },
];
const MIXED_MAINT: DemoScenario['maintenance'] = [
  { device: 'sw-bb-6', message: 'เปลี่ยนสวิตช์ 13:00–15:00', by: 'STF-02' },
];
const HISTORY: DemoScenario['history'] = [
  { device: 'ap-ba-5-2', severity: 'down', startMin: 130, endMin: 122, message: 'ไม่ตอบ ping' },
  { device: 'm-i1', severity: 'warn', startMin: 300, endMin: 297, message: 'latency 25 ms' },
  { device: 'wan1', severity: 'down', startMin: 540, endMin: 518, message: 'PPPoE หลุด' },
  { device: 'nvr-sp-0', severity: 'down', startMin: 1080, endMin: 1015, message: 'ไม่ตอบ ping' },
];
const unlocated = (apDown: boolean): DemoScenario['unlocated'] => [
  { name: 'SW-UNKNOWN-01', ip: '192.168.1.45', state: 'ok', group: 'Switches' },
  { name: 'AP-OLD-3F', ip: '192.168.50.23', state: apDown ? 'down' : 'ok', group: 'Access Points' },
  { name: 'Printer-HP-2F', ip: '192.168.10.88', state: 'ok', group: 'Printers' },
];
// LOC-050 = 8 เซียน ห้องคอม 40 ตัว, LOC-158 = ICET2 ชั้น 4 ห้องคอม (registry 40 / 29)
const MIXED_LABS = { 'LOC-050': 31, 'LOC-158': 24 };

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    name: 'mixed',
    title: 'เหตุการณ์ทั่วไป',
    description:
      'AP ล่ม 1, NVR ล่ม (รับเรื่องแล้ว), ไฟเบอร์ช้า, อินเทอร์เน็ตเส้น 2 เสียแพ็กเก็ต, สวิตช์อาคาร B ชั้น 6 บำรุงรักษา',
    lastUpdateMin: 0,
    signals: MIXED_SIGNALS,
    acks: MIXED_ACKS,
    maintenance: MIXED_MAINT,
    labOnline: MIXED_LABS,
    unlocated: unlocated(true),
    history: HISTORY,
  },
  {
    name: 's8down',
    title: 'main 8 เซียน ล่ม',
    description:
      'main อาคาร 8 เซียนไม่ตอบ อุปกรณ์ที่อยู่ใต้ทั้งหมดขาดการเชื่อมต่อจากต้นทาง ห้องคอมฯ ชั้น 5–6 ออฟไลน์',
    lastUpdateMin: 0,
    signals: [
      { device: 'm-s8', severity: 'down', sinceMin: 3, message: 'ไม่ตอบ ping · ไฟเบอร์จากอาคาร 2' },
    ],
    acks: [],
    maintenance: [],
    labOnline: { 'LOC-045': 0, 'LOC-049': 0, 'LOC-050': 0, 'LOC-158': 24 },
    unlocated: unlocated(true),
    history: HISTORY,
  },
  {
    name: 'storm',
    title: 'CCR1036 ล่ม ดับตามทั้งโรงเรียน',
    description:
      'CCR1036 ห้อง server ไม่ตอบ อุปกรณ์ 22 ตัวใน 6 อาคารดับตาม (Zabbix เห็น main ล่มด้วย 6 ตัว) อาคาร A กับ B ยังปกติเพราะต่อผ่าน MainA',
    lastUpdateMin: 0,
    signals: [
      { device: 'c1036', severity: 'down', sinceMin: 6, message: 'ไม่ตอบ ping' },
      ...['m-i2', 'm-s8', 'm-sp3', 'm-b1', 'm-b2', 'm-i1'].map((device) => ({
        device,
        severity: 'down' as const,
        sinceMin: 5,
        message: 'ไม่ตอบ ping',
      })),
      { device: 'mainB', severity: 'warn', sinceMin: 42, message: 'SFP 25 CRC +412 ใน 5 นาที' },
    ],
    acks: [],
    maintenance: [],
    labOnline: { 'LOC-045': 0, 'LOC-049': 0, 'LOC-050': 0, 'LOC-158': 0 },
    unlocated: unlocated(false),
    history: HISTORY,
  },
  {
    name: 'stale',
    title: 'ข้อมูลขาดการอัปเดต',
    description:
      'เหมือนเหตุการณ์ทั่วไป แต่ไม่ได้ข้อมูลใหม่จาก Zabbix มา 6 นาที หน้าจอต้องแสดงว่าสถานะค้าง',
    lastUpdateMin: 6,
    signals: MIXED_SIGNALS,
    acks: MIXED_ACKS,
    maintenance: MIXED_MAINT,
    labOnline: MIXED_LABS,
    unlocated: unlocated(true),
    history: HISTORY,
  },
  {
    name: 'normal',
    title: 'ปกติทั้งหมด',
    description: 'ทุกอุปกรณ์ปกติ ห้องคอมฯ ออนไลน์ครบ',
    lastUpdateMin: 0,
    signals: [],
    acks: [],
    maintenance: [],
    labOnline: {},
    unlocated: unlocated(false),
    history: HISTORY,
  },
];

export function findScenario(name: string): DemoScenario | undefined {
  return DEMO_SCENARIOS.find((s) => s.name === name);
}

/** The scenario as engine input at `now` (relative minutes → ISO times). */
export function scenarioInput(s: DemoScenario, now: Date): StatusInput {
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  return {
    lastUpdate: ago(s.lastUpdateMin),
    signals: s.signals.map((x) => ({
      device: x.device,
      severity: x.severity,
      since: ago(x.sinceMin),
      message: x.message,
    })),
    acks: s.acks.map((a) => ({ device: a.device, by: a.by, note: a.note, at: ago(a.atMin) })),
    maintenance: s.maintenance,
    labOnline: s.labOnline,
  };
}
