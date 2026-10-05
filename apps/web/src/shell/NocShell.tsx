// M18: the screen frame from the prototype — top bar, buildings + mini map (left), 3D scene
// (centre), alerts/history/unlocated (right), layers + legend (bottom), and a bottom sheet
// with tabs on phones. Panels read real data (layout from M14, live status from M16).
// M19: the 3D scene (Scene3D → scene/NocScene.ts) with building focus, floor cut, top view,
// fly-to from incidents, device details, mini map and eco mode.
// M20: search, 24 h history, unlocated hosts, computer labs, help + first-visit tour, TV mode and
// the demo mode band (`/?demo=<scenario>`, never mixed with real data).
import {
  DEVICE_STATE_TH,
  type Layout,
  type StatusHistory,
  type StatusSnapshot,
  type UnlocatedList,
  fillLinkTemplate,
  type LinkValues,
  type OutLinkSystem,
} from '@sbc-noc/shared';
import { LAYERS, STATE_ICON, type LayerKey, type UiState } from '@sbc-noc/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useLayout, useOutLinks } from '../data/api.js';
import {
  demoLabOnline,
  demoParam,
  useDemo,
  useDemoList,
  useHistory,
  useUnlocated,
} from '../data/extras.js';
import { defaultWsUrl, useLiveStatus, type LiveMode } from '../data/live.js';
import { buildSceneModel, deviceKind, type SceneModel } from '../scene/model.js';
import type { NocScene, Selection } from '../scene/NocScene.js';
import { useIncidentFeed, useNow } from './events.js';
import { Feed, HealthRing } from './feed.js';
import { Help, Tour, tourSeen } from './Help.js';
import {
  fmtAgo,
  History,
  Incidents,
  Labs,
  makeNames,
  Unlocated,
  unlocatedCount,
  type Names,
} from './panels.js';
import { Scene3D, saveEco, savedEco, useHint } from './Scene3D.js';
import { buildIndex, stateGetter, type SearchEntry } from './search.js';
import { SearchBox } from './Search.js';
import { useTheme } from './theme.js';
import { tvParam, useTvMode } from './tv.js';

type RightTab = 'inc' | 'hist' | 'unl';
type SheetTab = 'inc' | 'bld' | 'hist' | 'find';

const timeTh = (iso: string) =>
  new Date(iso).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const stateOfDevice = (snap: StatusSnapshot | null, code: string): UiState =>
  (snap?.states[code] as UiState | undefined) ?? 'ok';

interface ViewControls {
  ready: boolean;
  top: boolean;
  eco: boolean;
  tv: boolean;
  fps: number | null;
  onTop: () => void;
  onHome: () => void;
  onEco: () => void;
  onTv: () => void;
  onHelp: () => void;
}

/** Category chips of the prototype: usable/total and the worst state (maintenance not counted). */
function categoryChips(layout: Layout | undefined, snap: StatusSnapshot | null) {
  const cats = [
    {
      label: 'เครือข่าย',
      kinds: ['core', 'main', 'access'],
      tip: 'อุปกรณ์เครือข่ายที่ใช้งานได้/ทั้งหมด (เราเตอร์ main และสวิตช์ ไม่นับที่อยู่ระหว่างบำรุงรักษา)',
    },
    { label: 'AP', kinds: ['ap'], tip: 'Access Point ที่ใช้งานได้/ทั้งหมด (ไม่นับที่บำรุงรักษา)' },
    { label: 'NVR', kinds: ['nvr'], tip: 'เครื่องบันทึกกล้องวงจรปิดที่ใช้งานได้/ทั้งหมด' },
  ];
  return cats
    .map((c) => {
      const all = (layout?.devices ?? []).filter((d) => {
        const k = deviceKind(d);
        return k && c.kinds.includes(k) && stateOfDevice(snap, d.code) !== 'maint';
      });
      const sts = all.map((d) => stateOfDevice(snap, d.code));
      const on = sts.filter((s) => s === 'ok' || s === 'warn').length;
      const worst: UiState = sts.some((s) => s === 'down' || s === 'cut')
        ? 'down'
        : sts.some((s) => s === 'warn')
          ? 'warn'
          : 'ok';
      return { ...c, on, total: all.length, worst };
    })
    .filter((c) => c.total > 0);
}

function TopBar({
  snap,
  layout,
  mode,
  view,
  demo,
  search,
  theme,
  onBigNum,
  onGo,
}: {
  snap: StatusSnapshot | null;
  layout: Layout | undefined;
  mode: LiveMode | 'demo';
  view: ViewControls;
  demo: React.ReactNode;
  search: React.ReactNode;
  theme: ReturnType<typeof useTheme>;
  onBigNum: () => void;
  onGo: (code: string) => void;
}) {
  const open = snap?.incidents.filter((i) => !i.ack).length ?? 0;
  const wans = (layout?.devices ?? []).filter((d) => deviceKind(d) === 'wan');
  const cats = snap ? categoryChips(layout, snap) : [];
  const health = {
    on: cats.reduce((n, c) => n + c.on, 0),
    total: cats.reduce((n, c) => n + c.total, 0),
    worst: cats.some((c) => c.worst === 'down')
      ? ('down' as const)
      : cats.some((c) => c.worst === 'warn')
        ? ('warn' as const)
        : ('ok' as const),
  };
  return (
    <header id="top" className="panel">
      {demo}
      <h1>SB School NOC</h1>
      {snap && <HealthRing {...health} />}
      <button
        id="bigNum"
        className={open ? 'hot' : ''}
        title="เหตุที่ยังไม่มีคนรับเรื่อง"
        data-testid="open-incidents"
        onClick={onBigNum}
      >
        <b key={open}>{open}</b>
        <span>ยังไม่มีคนรับ</span>
      </button>
      {search}
      <div className="chips" aria-live="polite" data-testid="state-chips">
        {cats.map((c) => (
          <span key={`${c.label}${c.on}`} className={`chip st-${c.worst}`} title={c.tip}>
            <span className={`i ${c.worst}`}>{STATE_ICON[c.worst]}</span>
            {c.label} {c.on}/{c.total}
          </span>
        ))}
      </div>
      {snap && wans.length > 0 && (
        <div className="chips" id="wanChips" aria-label="สถานะอินเทอร์เน็ต">
          {wans.map((d) => {
            const st = stateOfDevice(snap, d.code);
            const inc = snap.incidents.find((i) => i.device === d.code);
            return (
              <button
                key={d.code}
                className={`chip wanchip st-${st}`}
                title={`อินเทอร์เน็ต ${d.name} · ${DEVICE_STATE_TH[st]}${inc ? ` · ${inc.message}` : ''}`}
                onClick={() => onGo(d.code)}
              >
                <span className={`i ${st}`}>{STATE_ICON[st]}</span>
                {d.name}
              </button>
            );
          })}
        </div>
      )}
      <span
        className={`chip${snap?.stale ? ' stale' : ''}`}
        id="fresh"
        data-testid="fresh"
        title={
          mode === 'demo'
            ? 'ข้อมูลสาธิต'
            : mode === 'live'
              ? 'รับข้อมูลสดผ่าน WebSocket · ถ้าค้างเกิน 2 นาทีจะขึ้นเตือน'
              : 'ดึงข้อมูลทุก 30 วินาที · ถ้าค้างเกิน 2 นาทีจะขึ้นเตือน'
        }
      >
        {!snap
          ? 'รอข้อมูล…'
          : snap.stale
            ? `ข้อมูลค้าง · ${timeTh(snap.lastUpdate)}`
            : `อัปเดต ${timeTh(snap.lastUpdate)}`}
        {mode === 'poll' ? ' · ดึงเอง' : ''}
      </span>
      {view.fps !== null && (
        <span className="chip" data-testid="fps" title="เฟรมต่อวินาทีเฉลี่ย 5 วินาทีล่าสุด">
          {Math.round(view.fps)} fps
        </span>
      )}
      <div className="topbtns">
        <button
          className="wide"
          aria-pressed={view.top}
          disabled={!view.ready}
          onClick={view.onTop}
          title="มองจากด้านบน"
        >
          มุมบน
        </button>
        <button disabled={!view.ready} onClick={view.onHome} title="กลับไปมุมมองทั้งโรงเรียน">
          ทั้งโรงเรียน
        </button>
        <button
          className="wide"
          aria-pressed={view.tv}
          onClick={view.onTv}
          title="เต็มจอ วนแจ้งเตือนที่ยังไม่มีคนรับจุดละ 10 วินาที เสียงเตือนเมื่อมีเหตุล่มใหม่"
          data-testid="tv"
        >
          โหมดทีวี
        </button>
        <button onClick={view.onHelp} aria-label="วิธีใช้" title="วิธีใช้ (กด ?)">
          ?
        </button>
        <button
          onClick={theme.toggle}
          aria-label={theme.theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
          title={theme.theme === 'dark' ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
          data-testid="theme-toggle"
        >
          {theme.theme === 'dark' ? '☀ สว่าง' : '☾ มืด'}
        </button>
        <button
          className="wide"
          aria-pressed={view.eco}
          disabled={!view.ready}
          onClick={view.onEco}
          title="ปิดแสงเรืองและหางแสง สำหรับเครื่องที่กราฟิกไม่แรง"
        >
          โหมดประหยัด
        </button>
        <Link to="/admin" className="btnlink">
          จัดการ
        </Link>
      </div>
    </header>
  );
}

/** Worst state of the devices in each building (prototype bStatus). */
function buildingStates(layout: Layout | undefined, snap: StatusSnapshot | null) {
  const out = new Map<string, { st: UiState; n: number }>();
  for (const d of layout?.devices ?? []) {
    if (!d.building || d.layer === 'planned') continue;
    const st = stateOfDevice(snap, d.code);
    const cur = out.get(d.building) ?? { st: 'ok' as UiState, n: 0 };
    if (st === 'down' || st === 'cut') cur.st = 'down';
    else if (st === 'warn' && cur.st !== 'down') cur.st = 'warn';
    else if (st === 'maint' && cur.st === 'ok') cur.st = 'maint';
    if (st === 'down' || st === 'cut' || st === 'warn') cur.n += 1;
    out.set(d.building, cur);
  }
  return out;
}

function BuildingList({
  layout,
  model,
  snap,
  selected,
  floor,
  onSelect,
  onFloor,
  onLab,
}: {
  layout: Layout | undefined;
  model: SceneModel | null;
  snap: StatusSnapshot | null;
  selected: string | null;
  floor: number | null;
  onSelect: (code: string | null) => void;
  onFloor: (floor: number | null) => void;
  onLab: (locCode: string) => void;
}) {
  if (!layout) return <p className="empty">กำลังโหลดผัง…</p>;
  const devicesIn = (b: string) => layout.devices.filter((d) => d.building === b).length;
  const states = buildingStates(layout, snap);
  const focused = layout.buildings.find((b) => b.code === selected);
  return (
    <>
      <ul className="blist" data-testid="buildings">
        {layout.buildings.map((b) => {
          const s = states.get(b.code) ?? { st: 'ok' as UiState, n: 0 };
          return (
            <li key={b.code}>
              <button
                aria-current={selected === b.code}
                onClick={() => onSelect(selected === b.code ? null : b.code)}
                title={DEVICE_STATE_TH[s.st]}
              >
                <span className={`i ${s.st}`}>{STATE_ICON[s.st]}</span>
                {b.name}
                <span className="n">
                  {s.n ? `${s.n} จุด · ` : ''}
                  {b.floorCount} ชั้น · {devicesIn(b.code)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {focused && (
        <div className="floorBox">
          <div className="floors" role="group" aria-label="เลือกชั้น" data-testid="floors">
            <button aria-pressed={!floor} onClick={() => onFloor(null)}>
              ทุกชั้น
            </button>
            {Array.from({ length: focused.floorCount }, (_, i) => i + 1).map((f) => (
              <button
                key={f}
                aria-pressed={floor === f}
                onClick={() => onFloor(f)}
                title={`แสดงถึงชั้น ${f} ซ่อนชั้นที่สูงกว่า`}
              >
                {f}
              </button>
            ))}
          </div>
          <button className="back" onClick={() => onSelect(null)}>
            ดูทั้งโรงเรียน
          </button>
          <Labs
            labs={(model?.labs ?? []).filter((l) => l.building === focused.code)}
            snap={snap}
            onLab={onLab}
          />
        </div>
      )}
    </>
  );
}

const KIND_TH: Record<string, string> = {
  core: 'อุปกรณ์แกนกลาง',
  main: 'main อาคาร',
  access: 'สวิตช์ประจำชั้น',
  ap: 'Access Point (Wi-Fi)',
  nvr: 'กล้องวงจรปิด',
  wan: 'อินเทอร์เน็ต',
  planned: 'วางแผน (ยังไม่ติดตั้ง)',
};
const MEDIA_TH: Record<string, string> = {
  fiber: 'ไฟเบอร์',
  copper: 'สาย LAN',
  lacp: 'LACP',
  trunk: 'VLAN trunk',
  pppoe: 'PPPoE',
  wireless: 'ไร้สาย',
  planned: 'วางแผน',
  patch: 'สาย patch',
};

const OUT_LINK_TEXT: Record<OutLinkSystem, { text: string; title: string }> = {
  zabbix: { text: 'เปิดใน Zabbix', title: 'ปัญหาและข้อมูลของ host ใน Zabbix' },
  grafana: { text: 'กราฟ (Grafana)', title: 'กราฟ ping / traffic ย้อนหลัง' },
  glpi: { text: 'ครุภัณฑ์ (GLPI)', title: 'ข้อมูลครุภัณฑ์และ ticket ใน GLPI' },
};

/** M22: buttons to Zabbix/Grafana/GLPI; a system without a template or a value shows nothing. */
function OutLinkButtons({ values }: { values: LinkValues }) {
  const links = useOutLinks();
  const items = (Object.keys(OUT_LINK_TEXT) as OutLinkSystem[])
    .map((sys) => ({ sys, url: fillLinkTemplate(links[sys], values) }))
    .filter((x): x is { sys: OutLinkSystem; url: string } => x.url !== null);
  if (!items.length) return null;
  return (
    <div className="links" data-testid="out-links">
      {items.map(({ sys, url }) => (
        <a
          key={sys}
          className="btnlink"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={OUT_LINK_TEXT[sys].title}
        >
          {OUT_LINK_TEXT[sys].text} ↗
        </a>
      ))}
    </div>
  );
}

/** Details of the clicked device or lab (prototype #info). */
function InfoPanel({
  sel,
  layout,
  model,
  snap,
  names,
  onClose,
}: {
  sel: Selection;
  layout: Layout;
  model: SceneModel;
  snap: StatusSnapshot | null;
  names: Names;
  onClose: () => void;
}) {
  let title: string;
  let sub: string;
  let rows: [string, React.ReactNode][];
  let linkValues: LinkValues;
  if (sel.kind === 'device') {
    // details come from the registry, so a device that is not drawn (no shape) still shows
    const d = layout.devices.find((x) => x.code === sel.code);
    if (!d) return null;
    const kind = deviceKind(d);
    const st = kind === 'planned' ? null : stateOfDevice(snap, d.code);
    const inc = snap?.incidents.find((i) => i.device === d.code);
    const maint = snap?.maintenance.find((m) => m.device === d.code);
    const up = d.uplink ? layout.devices.find((x) => x.code === d.uplink) : undefined;
    const down = layout.devices.filter((x) => x.uplink === d.code).length;
    linkValues = {
      code: d.code,
      name: d.name,
      hostname: d.hostname,
      ip: d.ip,
      loc: d.locCode,
      building: d.building,
      zabbixHostId: d.zabbixHostId,
      assetTag: d.assetTag,
    };
    title = d.name;
    sub = `${(kind && KIND_TH[kind]) ?? d.role}${d.building ? ` · ${names.where(d.code)}` : ''}`;
    rows = [
      [
        'สถานะ',
        st ? (
          <>
            <span className={`i ${st}`}>{STATE_ICON[st]}</span> {DEVICE_STATE_TH[st]}
            {inc ? ` ${fmtAgo(inc.since)}` : ''}
          </>
        ) : (
          <>
            <span className="i maint">{STATE_ICON.maint}</span> ยังไม่ติดตั้ง
          </>
        ),
      ],
      ['อาการ', inc?.message],
      [
        'บำรุงรักษา',
        maint
          ? `${maint.message} · โดย ${maint.by}`
          : st === 'maint'
            ? 'อยู่ใต้อุปกรณ์ที่บำรุงรักษา'
            : null,
      ],
      ['กระทบ', inc?.impacted ? `${inc.impacted} อุปกรณ์` : null],
      ['รับเรื่อง', inc?.ack ? `${inc.ack.by}${inc.ack.note ? ` · ${inc.ack.note}` : ''}` : null],
      ['รุ่น', d.model],
      ['IP', d.ip],
      ['ห้อง', d.locCode],
      [
        'ต่อจาก',
        up
          ? `${up.name}${d.uplinkMedia ? ` (${MEDIA_TH[d.uplinkMedia] ?? d.uplinkMedia})` : ''}`
          : null,
      ],
      ['ต่อไปยัง', down ? `${down} อุปกรณ์` : null],
      ['ข้อมูล', d.dataStatus === 'verified' ? null : 'ยังไม่ได้ตรวจหน้างาน'],
    ];
  } else {
    const lab = model.labs.find((l) => l.locCode === sel.locCode);
    if (!lab) return null;
    const on = snap?.labOnline[lab.locCode];
    linkValues = { code: lab.locCode, name: lab.name, loc: lab.locCode, building: lab.building };
    title = lab.name;
    sub = `${names.buildingName(lab.building)} ชั้น ${lab.floor} · ${lab.locCode}`;
    rows = [
      ['เครื่องตามทะเบียน', lab.pcs !== null ? `${lab.pcs} เครื่อง` : null],
      [
        'ออนไลน์',
        on !== undefined ? `${on}${lab.pcs ? `/${lab.pcs}` : ''} เครื่อง` : 'ยังไม่มีข้อมูล',
      ],
    ];
  }
  const shown = rows.filter((r) => r[1] !== null && r[1] !== undefined && r[1] !== '');
  return (
    <section id="info" className="panel open" aria-label="รายละเอียด" data-testid="info">
      <button className="close" onClick={onClose} aria-label="ปิดรายละเอียด">
        ✕
      </button>
      <h2>{title}</h2>
      <p className="sub">{sub}</p>
      <dl>
        {shown.map(([k, v]) => (
          <div key={k} className="row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <OutLinkButtons values={linkValues} />
    </section>
  );
}

/** Fibre colours of the scene with the route of their cable (registry). */
function fiberRows(model: SceneModel | null, layout: Layout | undefined) {
  const route = (code: string | null) => layout?.cables.find((c) => c.code === code)?.route;
  const name = (code: string) => layout?.devices.find((d) => d.code === code)?.name ?? code;
  return (model?.links ?? [])
    .filter((l) => l.kind === 'fiber')
    .map((f) => ({
      key: f.key,
      color: f.color,
      cable: f.cable,
      text: route(f.cable) ?? `${name(f.a)} → ${name(f.b)}`,
    }));
}

function FiberLegend({ rows }: { rows: ReturnType<typeof fiberRows> }) {
  if (!rows.length) return null;
  return (
    <details className="fibers">
      <summary>ไฟเบอร์ ▾</summary>
      <div id="fiberLegend" className="panel" data-testid="fiber-legend">
        <b>ไฟเบอร์</b>
        {rows.map((f) => (
          <span key={f.key}>
            <i className="fl" style={{ background: f.color ?? undefined }} />
            {f.text}
            {f.cable ? <small> · {f.cable}</small> : null}
          </span>
        ))}
      </div>
    </details>
  );
}

/** Demo band (M38/ADR-0014): always visible while a scenario is shown, never on the real page. */
function DemoBar({
  name,
  label,
  scenarios,
  unavailable,
  onScenario,
  onExit,
  onAbout,
}: {
  name: string;
  label: string;
  scenarios: { name: string; title: string }[];
  unavailable: boolean;
  onScenario: (name: string) => void;
  onExit: () => void;
  onAbout: () => void;
}) {
  return (
    <div id="demoBar" role="status" data-testid="demo-bar">
      {unavailable ? (
        <b>โหมดสาธิตปิดอยู่บนเครื่องนี้ (DEMO_MODE) — ไม่มีข้อมูลแสดง</b>
      ) : (
        <>
          <button className="chip demo" onClick={onAbout} title="อ่านเพิ่ม">
            {label}
          </button>
          <select
            aria-label="สถานการณ์สาธิต"
            value={name}
            onChange={(e) => onScenario(e.target.value)}
          >
            {scenarios.map((s) => (
              <option key={s.name} value={s.name}>
                สาธิต · {s.title}
              </option>
            ))}
          </select>
        </>
      )}
      <button onClick={onExit}>ออกจากโหมดสาธิต</button>
    </div>
  );
}

const showFps = () => {
  try {
    return new URLSearchParams(location.search).has('fps');
  } catch {
    return false;
  }
};
const isMobile = () => typeof matchMedia === 'function' && matchMedia('(max-width: 900px)').matches;

export function NocShell() {
  const loc = useLocation();
  const navigate = useNavigate();
  const demoName = demoParam(loc.search);
  const isDemo = demoName !== null;
  const layout = useLayout();
  const live = useLiveStatus(isDemo ? null : defaultWsUrl());
  const demoList = useDemoList(isDemo);
  const demo = useDemo(demoName);
  const historyQ = useHistory(!isDemo);
  const unlocatedQ = useUnlocated(!isDemo);

  const [rightTab, setRightTab] = useState<RightTab>('inc');
  const [sheetTab, setSheetTab] = useState<SheetTab>('inc');
  const [sheetMin, setSheetMin] = useState(false);
  const [leftMin, setLeftMin] = useState(false);
  const [rightMin, setRightMin] = useState(false);
  const [building, setBuilding] = useState<string | null>(null);
  const [floor, setFloor] = useState<number | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [top, setTop] = useState(false);
  const [eco, setEco] = useState(savedEco);
  const [fps, setFps] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [tour, setTour] = useState(false);
  const [hl, setHl] = useState<{ codes: string[]; label: string } | null>(null);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(
    Object.fromEntries(LAYERS.map((l) => [l.key, true])) as Record<LayerKey, boolean>,
  );
  const [scene, setScene] = useState<NocScene | null>(null);
  const [mini, setMini] = useState<HTMLCanvasElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const msearchRef = useRef<HTMLInputElement>(null);
  const fpsOn = useRef(showFps());
  const hint = useHint();
  const model = useMemo(() => (layout.data ? buildSceneModel(layout.data) : null), [layout.data]);
  const names = useMemo(() => makeNames(layout.data), [layout.data]);
  const index = useMemo(() => (layout.data ? buildIndex(layout.data) : []), [layout.data]);

  // one source per page: the live network, or a demo scenario — never both
  const snap: StatusSnapshot | null = useMemo(() => {
    if (!isDemo) return live.snapshot;
    const d = demo.data?.snapshot;
    return d ? demoLabOnline(d, model?.labs ?? []) : null;
  }, [isDemo, live.snapshot, demo.data, model]);
  const history: StatusHistory | null | undefined = isDemo ? demo.data?.history : historyQ.data;
  const unlocated: UnlocatedList | null | undefined = isDemo
    ? demo.data?.unlocated
    : unlocatedQ.data;
  // registry devices with no building at all (ISPs are drawn above the gateway, so not listed)
  const unplaced = useMemo(
    () =>
      (layout.data?.devices ?? [])
        .filter((d) => !d.building && deviceKind(d) !== null && deviceKind(d) !== 'wan')
        .map((d) => d.code),
    [layout.data],
  );
  const stateOf = useMemo(() => stateGetter(snap), [snap]);
  const bStates = useMemo(() => buildingStates(layout.data, snap), [layout.data, snap]);
  const fibers = useMemo(() => fiberRows(model, layout.data), [model, layout.data]);
  const incCount = snap?.incidents.length ?? 0;
  const unlCount = unlocatedCount(unlocated, unplaced);
  const feed = useIncidentFeed(snap, isDemo ? `demo:${demoName}` : 'live');
  const now = useNow();
  const demoLabel = isDemo ? (demo.data?.label ?? demoList.data?.label ?? 'ข้อมูลสาธิต') : null;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const focus = useCallback(
    (code: string | null, f: number | null = null) => {
      setBuilding(code);
      setFloor(f);
      setTop(false);
      scene?.focus(code, f);
    },
    [scene],
  );
  const onFloor = (f: number | null) => {
    const b = layout.data?.buildings.find((x) => x.code === building);
    focus(building, f);
    if (!b) return;
    setToast(
      !f
        ? 'แสดงครบทุกชั้น'
        : f < b.floorCount
          ? `แสดงถึงชั้น ${f} · ซ่อนชั้น ${f + 1}${f + 1 < b.floorCount ? `–${b.floorCount}` : ''} ชั่วคราว`
          : `แสดงถึงชั้น ${f} (ชั้นบนสุด)`,
    );
  };
  const go = useCallback(
    (code: string) => {
      const m = model?.devices.find((d) => d.code === code);
      const next: Selection = { kind: 'device', code };
      setSel(next);
      if (m?.building) {
        const b = model?.buildings.find((x) => x.code === m.building);
        setBuilding(m.building);
        setFloor(b && b.floors > 1 ? m.floor : null);
      }
      scene?.select(next);
    },
    [model, scene],
  );
  const goLab = (locCode: string) => {
    const lab = model?.labs.find((l) => l.locCode === locCode);
    if (!lab) return;
    const next: Selection = { kind: 'lab', locCode };
    setSel(next);
    setBuilding(lab.building);
    scene?.select(next);
  };
  const onSelect = useCallback((s: Selection | null) => setSel(s), []);
  const closeInfo = () => {
    setSel(null);
    scene?.select(null, false);
  };

  const pick = (e: SearchEntry) => {
    if (e.kind === 'b') focus(e.id);
    else if (e.kind === 'f') {
      focus(e.building, e.floor);
      setToast(e.label);
    } else if (e.kind === 'r') {
      if (e.lab && model?.labs.some((l) => l.locCode === e.id)) goLab(e.id);
      else {
        focus(e.building, e.floor);
        setToast(`${e.label} · ${e.sub}`);
      }
    } else {
      const L = e.layer as LayerKey | null;
      if (L && L in layers && !layers[L]) {
        setLayers({ ...layers, [L]: true });
        setToast('เปิดชั้นข้อมูลให้เห็นอุปกรณ์นี้แล้ว');
      }
      go(e.id);
    }
    setSheetMin(true);
  };
  const highlight = (codes: string[] | null, label = '') => {
    setHl(codes ? { codes, label } : null);
    scene?.highlight(codes);
  };

  const tvIdle = useRef(false);
  const tv = useTvMode({
    initial: tvParam(loc.search),
    snap,
    onShow: (device) => {
      tvIdle.current = false;
      scene?.setAutoRotate(false);
      go(device);
    },
    onIdle: () => {
      if (tvIdle.current) return;
      tvIdle.current = true;
      setSel(null);
      scene?.select(null, false);
      focus(null);
      scene?.setAutoRotate(true);
    },
    onExit: () => {
      tvIdle.current = false;
      scene?.setAutoRotate(false);
      focus(null);
    },
  });

  // first visit: short tour (not on TV screens)
  useEffect(() => {
    if (tourSeen() || tv.on) return;
    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => setTour(true), reduce ? 600 : 3800);
    return () => clearTimeout(t);
  }, [tv.on]);

  /** Unacked incidents first (worst first, as listed), then the acked ones; wraps around. */
  const nextIncident = () => {
    const list = snap?.incidents ?? [];
    const order = [...list.filter((i) => !i.ack), ...list.filter((i) => i.ack)]
      .map((i) => i.device)
      .filter((d) => names.has(d));
    if (!order.length) {
      setToast('ไม่มีเหตุที่มีตำแหน่งในผัง');
      return;
    }
    const cur = sel?.kind === 'device' ? order.indexOf(sel.code) : -1;
    const code = order[(cur + 1) % order.length] as string;
    go(code);
    setToast(`เหตุ ${((cur + 1) % order.length) + 1}/${order.length} · ${names.name(code)}`);
  };

  // single-key shortcuts (e.code: the same physical keys with the Thai layout)
  const hotkey = useRef<(code: string) => boolean>(() => false);
  hotkey.current = (code) => {
    const digit = /^Digit([1-9])$/.exec(code);
    if (digit) {
      const b = layout.data?.buildings[Number(digit[1]) - 1];
      if (!b) return false;
      focus(building === b.code ? null : b.code);
      setToast(building === b.code ? 'ดูทั้งโรงเรียน' : `อาคาร ${b.name}`);
      return true;
    }
    switch (code) {
      case 'KeyN':
        nextIncident();
        return true;
      case 'KeyT':
        view.onTop();
        return true;
      case 'KeyH':
      case 'Digit0':
        view.onHome();
        return true;
      case 'KeyE':
        view.onEco();
        setToast(eco ? 'ปิดโหมดประหยัด' : 'เปิดโหมดประหยัด');
        return true;
      case 'KeyL':
        theme.toggle();
        return true;
      case 'KeyF':
        if (document.fullscreenElement) void document.exitFullscreen?.();
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
        return true;
      default:
        return false;
    }
  };

  // keyboard: / or Ctrl+K search, ? help, Esc closes the top-most thing
  const esc = useRef<() => void>(() => undefined);
  esc.current = () => {
    if (tour) setTour(false);
    else if (help) setHelp(false);
    else if (sel) closeInfo();
    else if (hl) highlight(null);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = !!el && /INPUT|SELECT|TEXTAREA/.test(el.tagName);
      // e.code too: with the Thai layout the same keys give ฝ / ฦ / แ
      const ctrlK = (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'k' || e.code === 'KeyK');
      const slash = e.key === '/' || (e.code === 'Slash' && !e.shiftKey);
      const question = e.key === '?' || (e.code === 'Slash' && e.shiftKey);
      if (e.key === 'Escape') {
        esc.current();
        return;
      }
      if (typing && !ctrlK) return;
      if (slash || ctrlK) {
        e.preventDefault();
        if (isMobile()) {
          setSheetTab('find');
          setSheetMin(false);
          setTimeout(() => msearchRef.current?.focus(), 0);
        } else searchRef.current?.focus();
      } else if (question) {
        e.preventDefault();
        setHelp(true);
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && hotkey.current(e.code)) {
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const theme = useTheme();
  const view: ViewControls = {
    ready: !!scene,
    top,
    eco,
    tv: tv.on,
    fps: fpsOn.current ? fps : null,
    onTop: () => {
      setTop(!top);
      scene?.topView(!top);
    },
    onHome: () => {
      setTop(false);
      focus(null);
    },
    onEco: () => {
      setEco(!eco);
      saveEco(!eco);
      scene?.setEco(!eco);
    },
    onTv: tv.toggle,
    onHelp: () => setHelp(!help),
  };

  const searchProps = {
    index,
    stateOf,
    buildingState: (code: string) => bStates.get(code)?.st ?? 'ok',
    onPick: pick,
    onHighlight: (codes: string[], label: string) => highlight(codes, label),
    onNotFound: (q: string) => setToast(`ไม่พบ "${q}"`),
  } as const;

  const setDemo = (name: string | null) => {
    const p = new URLSearchParams(loc.search);
    if (name === null) p.delete('demo');
    else p.set('demo', name);
    const q = p.toString();
    setSel(null);
    highlight(null);
    void navigate({ pathname: loc.pathname, search: q ? `?${q}` : '' });
  };

  const incidentsPanel = (onGo: (c: string) => void) => (
    <Incidents
      snap={snap}
      layout={layout.data}
      names={names}
      current={sel?.kind === 'device' ? sel.code : null}
      demo={demoLabel}
      now={now}
      isFresh={(d) => feed.isFresh(d, now)}
      onGo={onGo}
      onNext={nextIncident}
    />
  );
  const historyPanel = (
    <History
      history={history}
      loading={isDemo ? demo.isLoading : historyQ.isLoading}
      names={names}
      building={building}
      onGo={go}
    />
  );
  const unlocatedPanel = (
    <Unlocated unlocated={unlocated} unplaced={unplaced} names={names} snap={snap} onGo={go} />
  );

  return (
    <div
      id="app"
      className={[
        snap?.stale ? 'stale' : '',
        tv.on ? 'tv' : '',
        isDemo ? 'demo' : '',
        eco ? 'calm' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Scene3D
        model={model}
        snapshot={snap}
        layers={layers}
        mini={mini}
        onReady={setScene}
        onSelect={onSelect}
        onFps={setFps}
        onInteract={hint.hide}
        onAutoEco={(f) => {
          setEco(true);
          setToast(`เปิดโหมดประหยัดอัตโนมัติ เพราะภาพกระตุก (${Math.round(f)} เฟรม/วินาที)`);
        }}
      />
      <div id="ui">
        <TopBar
          snap={snap}
          layout={layout.data}
          mode={isDemo ? 'demo' : live.mode}
          view={view}
          demo={
            demoName && (
              <DemoBar
                name={demoName}
                label={demoLabel ?? ''}
                scenarios={demoList.data?.scenarios ?? []}
                unavailable={demoList.isError || demo.isError}
                onScenario={(n) => setDemo(n)}
                onExit={() => setDemo(null)}
                onAbout={() => {
                  setHelp(true);
                  setTimeout(() => document.getElementById('demoHelp')?.scrollIntoView?.(), 0);
                }}
              />
            )
          }
          search={
            <SearchBox
              ref={searchRef}
              id="search"
              popup
              placeholder="ค้นหา ตึก ชั้น ห้อง อุปกรณ์ IP ( / )"
              {...searchProps}
            />
          }
          onBigNum={() => {
            setRightTab('inc');
            setRightMin(false);
            setSheetTab('inc');
            setSheetMin(false);
          }}
          theme={theme}
          onGo={go}
        />

        <div id="leftcol">
          <nav id="left" className={`panel${leftMin ? ' collapsed' : ''}`} aria-label="อาคาร">
            <p className="ptitle">
              อาคาร{' '}
              <button
                className="pmin"
                aria-label="ย่อแผงอาคาร"
                aria-expanded={!leftMin}
                onClick={() => setLeftMin(!leftMin)}
              >
                {leftMin ? '+' : '–'}
              </button>
            </p>
            <BuildingList
              layout={layout.data}
              model={model}
              snap={snap}
              selected={building}
              floor={floor}
              onSelect={(c) => focus(c)}
              onFloor={onFloor}
              onLab={goLab}
            />
          </nav>
          <figure id="miniBox" className="panel">
            <figcaption>
              แผนที่ย่อ <small>คลิกเพื่อย้ายมุมมอง</small>
            </figcaption>
            <canvas
              id="mini"
              ref={setMini}
              tabIndex={0}
              role="img"
              aria-label="แผนที่ย่อ แสดงพื้นที่ที่กำลังมองและจุดที่มีปัญหา คลิกหรือใช้ลูกศรเพื่อย้ายมุมมอง"
              onClick={(e) => scene?.miniClick(e.clientX, e.clientY)}
              onKeyDown={(e) => {
                const m = (
                  {
                    ArrowUp: [0, -4],
                    ArrowDown: [0, 4],
                    ArrowLeft: [-4, 0],
                    ArrowRight: [4, 0],
                  } as Record<string, [number, number]>
                )[e.key];
                if (!m) return;
                e.preventDefault();
                scene?.pan(m[0], m[1]);
              }}
            />
            <p className="mlegend">
              <span>
                <i className="view" />
                ที่เห็นอยู่
              </span>
              <span>
                <b className="i down">{STATE_ICON.down}</b>ล่ม
              </span>
              <span>
                <b className="i warn">{STATE_ICON.warn}</b>เตือน
              </span>
            </p>
          </figure>
        </div>

        <main id="center" aria-label="ผัง 3 มิติ">
          {snap?.stale && (
            <div id="staleBar" role="alert">
              ข้อมูลค้าง — ไม่ได้รับข้อมูลใหม่จาก Zabbix ตั้งแต่ {timeTh(snap.lastUpdate)}{' '}
              สถานะที่เห็นอาจไม่ตรงความจริง
            </div>
          )}
          {hl && (
            <div id="hlBar" className="panel" data-testid="hl-bar">
              ไฮไลต์ผลค้นหา &quot;{hl.label}&quot; {hl.codes.length} รายการ{' '}
              <button onClick={() => highlight(null)}>ล้าง</button>
            </div>
          )}
          {hint.show && scene && !tv.on && <p id="hint">{hint.text}</p>}
          {toast && (
            <div id="toast" role="status" key={toast}>
              {toast}
            </div>
          )}
          <Feed events={feed.events} names={names} onGo={go} onDismiss={feed.dismiss} />
          {sel && layout.data && model && (
            <InfoPanel
              sel={sel}
              layout={layout.data}
              model={model}
              snap={snap}
              names={names}
              onClose={closeInfo}
            />
          )}
        </main>

        <aside id="right" className={`panel${rightMin ? ' collapsed' : ''}`} aria-label="แจ้งเตือน">
          <div className="rtabs" role="tablist">
            {(
              [
                ['inc', `แจ้งเตือน ${incCount ? `(${incCount})` : ''}`],
                ['hist', 'ประวัติ'],
                ['unl', `ไม่มีตำแหน่ง ${unlCount ? `(${unlCount})` : ''}`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={rightTab === k}
                onClick={() => {
                  setRightTab(k);
                  setRightMin(false);
                }}
              >
                {label}
              </button>
            ))}
            <button
              className="pmin"
              aria-label="ย่อแผงแจ้งเตือน"
              aria-expanded={!rightMin}
              onClick={() => setRightMin(!rightMin)}
            >
              {rightMin ? '+' : '–'}
            </button>
          </div>
          <div className="rbody">
            {rightTab === 'inc' && incidentsPanel(go)}
            {rightTab === 'hist' && historyPanel}
            {rightTab === 'unl' && unlocatedPanel}
          </div>
        </aside>

        <footer id="bottom" className="panel">
          {LAYERS.map((l) => (
            <label key={l.key}>
              <input
                type="checkbox"
                checked={layers[l.key]}
                onChange={(e) => setLayers({ ...layers, [l.key]: e.target.checked })}
              />
              <span className="sw" style={{ background: l.color }} />
              {l.label}
            </label>
          ))}
          <FiberLegend rows={fibers} />
          <span className="stlegend" title="ความหมายสัญลักษณ์สถานะ">
            <span className="i ok">{STATE_ICON.ok}</span>ปกติ{' '}
            <span className="i warn">{STATE_ICON.warn}</span>เตือน{' '}
            <span className="i down">{STATE_ICON.down}</span>ล่ม{' '}
            <span className="i cut">{STATE_ICON.cut}</span>
            ขาดจากต้นทาง <span className="i maint">{STATE_ICON.maint}</span>บำรุงรักษา
          </span>
        </footer>

        {help && (
          <Help
            fibers={fibers.map((f) => ({ color: f.color, text: f.text }))}
            demo={demoLabel}
            onClose={() => setHelp(false)}
            onTour={() => {
              setHelp(false);
              setTour(true);
            }}
          />
        )}
        {tour && <Tour onDone={() => setTour(false)} />}

        <section id="sheet" className={`panel${sheetMin ? ' min' : ''}`} aria-label="แผงข้อมูล">
          <div className="tabs" role="tablist">
            {(
              [
                ['inc', `แจ้งเตือน ${incCount ? `(${incCount})` : ''}`],
                ['bld', 'อาคาร'],
                ['hist', 'ประวัติ'],
                ['find', 'ค้นหา'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={sheetTab === k}
                onClick={() => {
                  setSheetTab(k);
                  setSheetMin(false);
                }}
              >
                {label}
              </button>
            ))}
            <button
              id="sheetMin"
              aria-label="ย่อ/ขยาย"
              aria-expanded={!sheetMin}
              onClick={() => setSheetMin(!sheetMin)}
            >
              {sheetMin ? '▴' : '▾'}
            </button>
          </div>
          <div className="tabbody">
            {sheetTab === 'inc' &&
              incidentsPanel((c) => {
                go(c);
                setSheetMin(true);
              })}
            {sheetTab === 'bld' && (
              <>
                <BuildingList
                  layout={layout.data}
                  model={model}
                  snap={snap}
                  selected={building}
                  floor={floor}
                  onSelect={(c) => focus(c)}
                  onFloor={onFloor}
                  onLab={goLab}
                />
                <p className="sub2">ไม่มีตำแหน่ง {unlCount ? `(${unlCount})` : ''}</p>
                {unlocatedPanel}
              </>
            )}
            {sheetTab === 'hist' && historyPanel}
            {sheetTab === 'find' && (
              <SearchBox
                ref={msearchRef}
                id="msearch"
                popup={false}
                placeholder="ค้นหา ตึก ชั้น ห้อง อุปกรณ์ IP"
                {...searchProps}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
