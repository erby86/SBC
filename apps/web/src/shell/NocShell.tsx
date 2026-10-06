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
import { BREAKPOINTS, LAYERS, STATE_ICON, type LayerKey, type UiState } from '@sbc-noc/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
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
import { useTabStatus } from './tab.js';
import { ownCards, rootGroup, shownState, topCounts } from './console.js';
import { EventLog } from './evlog.js';
import { Leaving } from './leaving.js';
import { Feed } from './feed.js';
import { Help, Tour, tourSeen } from './Help.js';
import { Icon } from './icons.js';
import { Menu } from './Menu.js';
import { plainMessage } from './messages.js';
import {
  FirstCard,
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
import { StaleBand, staleCause } from './stale.js';
import { useTheme } from './theme.js';
import { tvParam, useTvMode } from './tv.js';

type RightTab = 'inc' | 'hist' | 'unl';

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
  theme: ReturnType<typeof useTheme>;
}

/** Devices the top bar counts (network, AP, NVR — maintenance not counted): usable/total + worst. */
function deviceHealth(layout: Layout | undefined, snap: StatusSnapshot | null) {
  const kinds = ['core', 'main', 'access', 'ap', 'nvr'];
  const sts = (layout?.devices ?? [])
    .filter((d) => {
      const k = deviceKind(d);
      return k && kinds.includes(k) && stateOfDevice(snap, d.code) !== 'maint';
    })
    .map((d) => stateOfDevice(snap, d.code));
  const worst = (list: UiState[]): UiState =>
    list.some((s) => s === 'down' || s === 'cut')
      ? 'down'
      : list.some((s) => s === 'warn')
        ? 'warn'
        : 'ok';
  return {
    on: sts.filter((s) => s === 'ok' || s === 'warn').length,
    total: sts.length,
    worst: worst(sts),
  };
}

function TopBar({
  snap,
  layout,
  mode,
  view,
  demo,
  search,
  menu,
  notLive,
  onBigNum,
  onGo,
}: {
  snap: StatusSnapshot | null;
  layout: Layout | undefined;
  mode: LiveMode | 'demo';
  view: ViewControls;
  demo: React.ReactNode;
  search: React.ReactNode;
  menu: React.ReactNode;
  /** The screen is not live for any reason (offline, server, Zabbix): grey chip. */
  notLive: boolean;
  onBigNum: () => void;
  onGo: (code: string) => void;
}) {
  const known = new Set((layout?.devices ?? []).map((d) => d.code));
  const tc = snap ? topCounts(snap, layout ? (c) => known.has(c) : undefined) : null;
  const downs = tc?.out ?? 0;
  const warns = tc?.warn ?? 0;
  const open = tc?.open ?? 0;
  const wans = (layout?.devices ?? []).filter((d) => deviceKind(d) === 'wan');
  const wanSt = wans.map((d) => ({ d, st: stateOfDevice(snap, d.code) }));
  const wanBad = wanSt.filter((w) => w.st !== 'ok' && w.st !== 'maint');
  const wanWorst: UiState = wanBad.some((w) => w.st === 'down' || w.st === 'cut')
    ? 'down'
    : wanBad.length
      ? 'warn'
      : 'ok';
  const dev = deviceHealth(layout, snap);
  return (
    <header id="top" className="panel">
      {demo}
      <h1 className="brand" title="SB School NOC — ศูนย์ดูแลเครือข่ายของโรงเรียน">
        <span className="logo">
          <Icon name="logo" />
        </span>
        <span className="bt">
          <small>โรงเรียน SB School</small> ศูนย์ดูแลเครือข่าย
        </span>
      </h1>
      <div className="nums" aria-live="polite">
        <button
          className="num down"
          onClick={onBigNum}
          title={
            tc && tc.roots > 1
              ? `อุปกรณ์ที่ใช้งานไม่ได้ (รวมที่ดับตาม) จากต้นเหตุ ${tc.roots} จุด`
              : 'อุปกรณ์ที่ใช้งานไม่ได้ (รวมที่ดับตามต้นเหตุ)'
          }
        >
          <b className={downs ? 'hot' : ''}>{snap ? downs : '–'}</b>
          <span>ใช้งานไม่ได้</span>
        </button>
        {tc?.oneRoot && (
          <span className="oneroot" data-testid="one-root">
            จากต้นเหตุเดียว
          </span>
        )}
        <button className="num warn" onClick={onBigNum} title="เหตุที่ควรตรวจสอบ">
          <b className={warns ? 'hot' : ''}>{snap ? warns : '–'}</b>
          <span>ควรตรวจสอบ</span>
        </button>
        <button
          id="bigNum"
          className={`num${open ? ' hot' : ''}`}
          title="เหตุที่ยังไม่มีคนรับเรื่อง"
          data-testid="open-incidents"
          onClick={onBigNum}
        >
          <b key={open}>{snap ? open : '–'}</b>
          <span>ยังไม่มีคนรับ</span>
        </button>
      </div>
      {snap && (
        <div className="chips" data-testid="state-chips">
          <span
            className={`chip st-${dev.worst}`}
            title="อุปกรณ์ที่ใช้งานได้/ทั้งหมด (เครือข่าย AP NVR ไม่นับที่บำรุงรักษา)"
          >
            <i className={`sdot ${dev.worst}`} aria-hidden="true" />
            <span>
              อุปกรณ์ <b>{dev.on}</b>/{dev.total}
            </span>
          </span>
          {wans.length > 0 && (
            <button
              className={`chip wanchip st-${wanWorst}`}
              title={wanSt.map(({ d, st }) => `${d.name} · ${DEVICE_STATE_TH[st]}`).join('\n')}
              onClick={() => {
                const w = wanBad[0];
                if (w) onGo(w.d.code);
              }}
            >
              <i className={`sdot ${wanWorst}`} aria-hidden="true" />
              <span>
                อินเทอร์เน็ต <b>{wans.length - wanBad.length}</b>/{wans.length}
              </span>
            </button>
          )}
        </div>
      )}
      <div className="sfield">
        <Icon name="search" className="sicon" />
        {search}
      </div>
      <span
        className={`chip fresh ${!snap ? 'f-wait' : notLive ? 'stale' : `f-${mode}`}`}
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
        <i className="dot" aria-hidden="true" />
        {!snap ? (
          'รอข้อมูล…'
        ) : notLive ? (
          `ข้อมูลค้าง · ${timeTh(snap.lastUpdate)}`
        ) : (
          <>
            <span className="fw">อัปเดต </span>
            {timeTh(snap.lastUpdate)}
          </>
        )}
        {mode === 'poll' ? ' · ดึงเอง' : ''}
      </span>
      {view.fps !== null && (
        <span className="chip" data-testid="fps" title="เฟรมต่อวินาทีเฉลี่ย 5 วินาทีล่าสุด">
          {Math.round(view.fps)} fps
        </span>
      )}
      {menu}
    </header>
  );
}

interface BState {
  st: UiState;
  /** Devices with a problem (down, cut or warn). */
  n: number;
  /** Usable/total devices (planned and maintenance not counted). */
  up: number;
  total: number;
}

/** Worst state of the devices in each building (prototype bStatus) and how many are usable. */
/** Per building: down when a root cause is in it, cut (grey) when its devices only went out
 * behind a root cause elsewhere, then warn, maintenance. */
function buildingStates(layout: Layout | undefined, snap: StatusSnapshot | null) {
  const out = new Map<string, BState>();
  for (const d of layout?.devices ?? []) {
    if (!d.building || d.layer === 'planned') continue;
    const st: UiState = shownState(snap, d.code);
    const cur = out.get(d.building) ?? { st: 'ok' as UiState, n: 0, up: 0, total: 0 };
    if (st === 'down') cur.st = 'down';
    else if (st === 'cut' && cur.st !== 'down') cur.st = 'cut';
    else if (st === 'warn' && cur.st !== 'down' && cur.st !== 'cut') cur.st = 'warn';
    else if (st === 'maint' && cur.st === 'ok') cur.st = 'maint';
    if (st === 'down' || st === 'cut' || st === 'warn') cur.n += 1;
    if (st !== 'maint') {
      cur.total += 1;
      if (st === 'ok' || st === 'warn') cur.up += 1;
    }
    out.set(d.building, cur);
  }
  return out;
}

const RANK: Record<UiState, number> = { down: 0, cut: 1, warn: 2, maint: 3, ok: 4 };
const bad = (s: BState | undefined) =>
  !!s && (s.st === 'down' || s.st === 'cut' || s.st === 'warn');

/** Buildings with a problem first (worst first, layout order otherwise). */
function sortedBuildings(layout: Layout, states: Map<string, BState>) {
  const st = (code: string) => states.get(code)?.st ?? 'ok';
  return [...layout.buildings].sort((a, b) => RANK[st(a.code)] - RANK[st(b.code)]);
}

/** Left column: buildings with a problem as cards with a usable bar, the rest as small rows. */
function BuildingList({
  layout,
  states,
  selected,
  onSelect,
}: {
  layout: Layout | undefined;
  states: Map<string, BState>;
  selected: string | null;
  onSelect: (code: string | null) => void;
}) {
  if (!layout) return <p className="empty">กำลังโหลดผัง…</p>;
  const list = sortedBuildings(layout, states);
  const hot = list.filter((b) => bad(states.get(b.code)));
  const calm = list.filter((b) => !bad(states.get(b.code)));
  const pick = (code: string) => onSelect(selected === code ? null : code);
  return (
    <div className="blist" data-testid="buildings">
      {hot.map((b) => {
        const s = states.get(b.code) as BState;
        return (
          <button
            key={b.code}
            className={`bhot ${s.st}`}
            aria-current={selected === b.code}
            onClick={() => pick(b.code)}
            title={`${DEVICE_STATE_TH[s.st]} · ใช้งานได้ ${s.up}/${s.total} อุปกรณ์`}
          >
            <span className="r1">
              <i className={`sdot ${s.st}`} aria-hidden="true" />
              <span className="nm">{b.name}</span>
              <span className={`iss ${s.st}`}>
                {STATE_ICON[s.st]} {s.n}
              </span>
            </span>
            <span className="r2">
              <span className="bar">
                <i style={{ width: `${s.total ? Math.round((s.up / s.total) * 100) : 100}%` }} />
              </span>
              <span className="up">
                {s.up}/{s.total}
              </span>
            </span>
          </button>
        );
      })}
      {hot.length > 0 && calm.length > 0 && <hr />}
      {calm.map((b) => {
        const s = states.get(b.code);
        const st = s?.st ?? 'ok';
        return (
          <button
            key={b.code}
            className="bcalm"
            aria-current={selected === b.code}
            onClick={() => pick(b.code)}
            title={`${DEVICE_STATE_TH[st]} · ${s?.total ?? 0} อุปกรณ์`}
          >
            <i className={`sdot sm ${st}`} aria-hidden="true" />
            <span className="nm">{b.name}</span>
            <span className="fl">{b.floorCount} ชั้น</span>
          </button>
        );
      })}
    </div>
  );
}

/** Building chips over the map when there is no left column (< 1180 px). */
function BuildingStrip({
  layout,
  states,
  selected,
  onSelect,
}: {
  layout: Layout | undefined;
  states: Map<string, BState>;
  selected: string | null;
  onSelect: (code: string | null) => void;
}) {
  if (!layout) return null;
  return (
    <div className="bstrip" role="group" aria-label="เลือกอาคาร">
      {sortedBuildings(layout, states).map((b) => {
        const st = states.get(b.code)?.st ?? 'ok';
        return (
          <button
            key={b.code}
            className={`bchip ${st}`}
            aria-pressed={selected === b.code}
            onClick={() => onSelect(selected === b.code ? null : b.code)}
            title={DEVICE_STATE_TH[st]}
          >
            <i className={`sdot sm ${st}`} aria-hidden="true" />
            {b.name}
          </button>
        );
      })}
    </div>
  );
}

/** Card of the focused building over the map: counts, floor cut, computer labs. */
function BuildingCard({
  layout,
  model,
  snap,
  states,
  code,
  floor,
  names,
  onFloor,
  onClose,
  onLab,
}: {
  layout: Layout;
  model: SceneModel | null;
  snap: StatusSnapshot | null;
  states: Map<string, BState>;
  code: string;
  floor: number | null;
  names: Names;
  onFloor: (floor: number | null) => void;
  onClose: () => void;
  onLab: (locCode: string) => void;
}) {
  const b = layout.buildings.find((x) => x.code === code);
  if (!b) return null;
  const s = states.get(code);
  const st = s?.st ?? 'ok';
  const open = (snap?.incidents ?? []).filter((i) => names.building(i.device) === code);
  return (
    <section id="bcard" className="panel" aria-label={`อาคาร ${b.name}`} data-testid="bcard">
      <div className="bh">
        <i className={`sdot ${st}`} aria-hidden="true" />
        <h2>{b.name}</h2>
        <button
          className="close"
          onClick={onClose}
          aria-label="ดูทั้งโรงเรียน"
          title="ดูทั้งโรงเรียน"
        >
          ✕
        </button>
      </div>
      <div className="bnums">
        <span>
          <small>ชั้น</small>
          <b>{b.floorCount}</b>
        </span>
        <span>
          <small>อุปกรณ์</small>
          <b>{layout.devices.filter((d) => d.building === code).length}</b>
        </span>
        <span>
          <small>เหตุเปิด</small>
          <b className={open.length ? st : ''}>{open.length}</b>
        </span>
      </div>
      <p className={`bnote${open.length ? '' : ' ok'}`}>
        {open.length
          ? open.map((i) => names.name(i.device)).join(' · ')
          : 'ทุกอุปกรณ์ในอาคารนี้ใช้งานได้'}
      </p>
      <div className="floors" role="group" aria-label="เลือกชั้น" data-testid="floors">
        <button aria-pressed={!floor} onClick={() => onFloor(null)}>
          ทุกชั้น
        </button>
        {Array.from({ length: b.floorCount }, (_, i) => i + 1).map((f) => (
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
      <Labs
        labs={(model?.labs ?? []).filter((l) => l.building === code)}
        snap={snap}
        onLab={onLab}
      />
    </section>
  );
}

/** Fibre links whose far end is not usable; the rest only counted (left column). */
function FiberHealth({
  model,
  layout,
  snap,
  rows,
  onGo,
}: {
  model: SceneModel | null;
  layout: Layout | undefined;
  snap: StatusSnapshot | null;
  rows: ReturnType<typeof fiberRows>;
  onGo: (code: string) => void;
}) {
  const fibers = (model?.links ?? []).filter((l) => l.kind === 'fiber');
  if (!fibers.length || !snap) return null;
  const badOnes = fibers
    .map((f) => ({ f, st: shownState(snap, f.b) }))
    .filter(({ st }) => st === 'down' || st === 'cut');
  if (!badOnes.length) return null; // all fine: nothing to say (declutter)
  const text = (key: string) => rows.find((r) => r.key === key)?.text ?? key;
  const nm = (code: string) => layout?.devices.find((d) => d.code === code)?.name ?? code;
  return (
    <section className="panel fibers-box" aria-label="ลิงก์ไฟเบอร์" data-testid="fiber-health">
      <p className="ptitle">
        ลิงก์ไฟเบอร์
        <span className={badOnes.length ? 'cnt' : 'cnt ok'}>
          ปกติ {fibers.length - badOnes.length}/{fibers.length}
        </span>
      </p>
      {badOnes.map(({ f, st }) => (
        <button
          key={f.key}
          className={`fbad ${st}`}
          onClick={() => onGo(f.b)}
          title={`${text(f.key)} · ปลายทาง ${nm(f.b)} ${DEVICE_STATE_TH[st]}`}
        >
          <i className="fl" style={{ background: f.color ?? undefined }} aria-hidden="true" />
          <span className="tx">
            {text(f.key)}
            {f.cable && <small>{f.cable}</small>}
          </span>
          <span className="st">{st === 'cut' ? 'หลังต้นเหตุ' : 'ไม่ตอบ'}</span>
        </button>
      ))}
    </section>
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
      ['อาการ', inc ? plainMessage(inc.message) : undefined],
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
/** Single column (< 980 px): the map and the alerts are stacked and the page scrolls. */
const stacked = () =>
  typeof matchMedia === 'function' &&
  matchMedia(`(max-width: ${BREAKPOINTS.stack - 0.02}px)`).matches;
/** Bring a stacked part of the page into view (no-op when everything is on screen). */
const reveal = (id: string) => {
  if (!stacked()) return;
  const el = document.getElementById(id);
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight)
    el.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
};

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
    // planned controllers start hidden (declutter); the layer bar shows them on demand
    Object.fromEntries(LAYERS.map((l) => [l.key, l.key !== 'planned'])) as Record<
      LayerKey,
      boolean
    >,
  );
  const [scene, setScene] = useState<NocScene | null>(null);
  const [mini, setMini] = useState<HTMLCanvasElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
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
  const incCount = ownCards(snap?.incidents ?? []).length;
  const outLinks = useOutLinks();
  const zabbixUrl = (code: string) => {
    const d = layout.data?.devices.find((x) => x.code === code);
    return d
      ? fillLinkTemplate(outLinks.zabbix, {
          code: d.code,
          name: d.name,
          hostname: d.hostname,
          ip: d.ip,
          loc: d.locCode,
          building: d.building,
          zabbixHostId: d.zabbixHostId,
          assetTag: d.assetTag,
        })
      : null;
  };
  const cause = isDemo
    ? snap?.stale
      ? 'zabbix'
      : null
    : staleCause({ online: live.online, link: live.link, stale: snap?.stale });
  // "+N ตัว" in the log counts like the root-cause card: every device out behind the root
  const outOf = useCallback(
    (root: string) => (snap ? rootGroup(snap, layout.data?.devices ?? [], root).dark.length : 0),
    [snap, layout.data],
  );
  // what floats over the top of the scene (the map title from 1180 px, the not-live band):
  // scene labels keep below it instead of hiding under it
  useEffect(() => {
    if (!scene) return;
    const stage = document.querySelector<HTMLElement>('#center > .stage');
    const head = document.querySelector<HTMLElement>('#center > .mhead');
    const band = cause ? document.getElementById('staleBand') : null;
    const fit = () => {
      const top = stage?.getBoundingClientRect().top ?? 0;
      let inset = 0;
      if (head && getComputedStyle(head).position === 'absolute')
        inset = head.getBoundingClientRect().bottom - top;
      if (band) inset = Math.max(inset, band.getBoundingClientRect().bottom - top + 4);
      scene.setTopInset(inset);
    };
    fit();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    for (const el of [stage, head, band]) if (el) ro?.observe(el);
    return () => {
      ro?.disconnect();
      scene.setTopInset(0);
    };
  }, [scene, cause]);
  const zabbixHome = useMemo(() => {
    try {
      return outLinks.zabbix ? new URL(outLinks.zabbix.replace(/\{[^}]*\}/g, '0')).origin : null;
    } catch {
      return null;
    }
  }, [outLinks.zabbix]);
  const unlCount = unlocatedCount(unlocated, unplaced);
  const feed = useIncidentFeed(snap, isDemo ? `demo:${demoName}` : 'live');
  const now = useNow();
  useTabStatus(snap, feed.events, isDemo);
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
      reveal('center');
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
    reveal('center');
  };
  const highlight = (codes: string[] | null, label = '') => {
    setHl(codes ? { codes, label } : null);
    scene?.highlight(codes);
  };

  const tvIdle = useRef(false);
  const tv = useTvMode({
    initial: tvParam(loc.search),
    snap,
    onIdle: () => {
      if (tvIdle.current) return;
      tvIdle.current = true;
      setSel(null);
      scene?.select(null, false);
      focus(null);
      // nothing wrong: the screen stays still (motion standard), no turning around the school
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
    const list = ownCards(snap?.incidents ?? []);
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
        searchRef.current?.focus();
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
    theme,
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
  const tabs = [
    ['inc', `เปิดอยู่ ${incCount}`],
    ['hist', `ประวัติ ${history?.hours ?? 24} ชม.`],
    // devices without a position open from the menu; their tab shows only while looked at
    ...(rightTab === 'unl' && unlCount ? [['unl', `ไม่มีตำแหน่ง ${unlCount}`] as const] : []),
  ] as const;
  const tab = rightTab === 'unl' && !unlCount ? 'inc' : rightTab;

  return (
    <div
      id="app"
      className={[cause ? 'stale' : '', tv.on ? 'tv' : '', isDemo ? 'demo' : '', eco ? 'calm' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <div id="ui">
        <TopBar
          snap={snap}
          layout={layout.data}
          mode={isDemo ? 'demo' : live.mode}
          notLive={!!cause}
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
          menu={
            <Menu
              ready={view.ready}
              top={view.top}
              tv={view.tv}
              eco={view.eco}
              dark={theme.theme === 'dark'}
              layers={layers}
              fibers={fibers}
              unlocated={unlCount}
              onTop={view.onTop}
              onTv={view.onTv}
              onEco={view.onEco}
              onTheme={theme.toggle}
              onLayer={(k) => setLayers({ ...layers, [k]: !layers[k] })}
              onUnlocated={() => {
                setRightTab('unl');
                reveal('right');
              }}
              onHelp={view.onHelp}
            />
          }
          onBigNum={() => {
            setRightTab('inc');
            reveal('right');
          }}
          onGo={go}
        />

        <div id="leftcol">
          <nav id="left" className="panel" aria-label="อาคาร">
            <p className="ptitle">อาคาร</p>
            <BuildingList
              layout={layout.data}
              states={bStates}
              selected={building}
              onSelect={(c) => focus(c)}
            />
          </nav>
          <FiberHealth model={model} layout={layout.data} snap={snap} rows={fibers} onGo={go} />
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
          </figure>
        </div>

        <main id="center" className="panel" aria-label="ผัง 3 มิติ">
          <div className="mhead">
            <h2 className="ptitle">ผังเครือข่าย 3 มิติ</h2>
            <button
              className="ib"
              disabled={!view.ready}
              onClick={view.onHome}
              aria-label="ทั้งโรงเรียน"
              title="กลับไปมุมมองทั้งโรงเรียน (H)"
            >
              <Icon name="home" />
            </button>
          </div>
          <BuildingStrip
            layout={layout.data}
            states={bStates}
            selected={building}
            onSelect={(c) => focus(c)}
          />
          <div className="stage">
            <Scene3D
              model={model}
              snapshot={snap}
              layers={layers}
              mini={mini}
              onReady={setScene}
              onSelect={onSelect}
              onFps={setFps}
              onInteract={hint.hide}
              still={!!cause}
              onAutoEco={(f) => {
                setEco(true);
                setToast(`เปิดโหมดประหยัดอัตโนมัติ เพราะภาพกระตุก (${Math.round(f)} เฟรม/วินาที)`);
              }}
            />
            {cause && (
              <StaleBand
                cause={cause}
                lastUpdate={snap?.lastUpdate}
                lastTime={snap ? timeTh(snap.lastUpdate) : null}
                now={now}
                tries={live.tries}
                zabbixHome={zabbixHome}
                onRetry={live.retry}
              />
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
            {building && layout.data && !sel && (
              <BuildingCard
                layout={layout.data}
                model={model}
                snap={snap}
                states={bStates}
                code={building}
                floor={floor}
                names={names}
                onFloor={onFloor}
                onClose={() => focus(null)}
                onLab={goLab}
              />
            )}
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
          </div>
          <EventLog history={history} snap={snap} names={names} now={now} outOf={outOf} onGo={go} />
        </main>

        <div id="rightcol">
          <FirstCard
            snap={snap}
            layout={layout.data}
            names={names}
            demo={isDemo}
            now={now}
            zabbixUrl={zabbixUrl}
            onGo={go}
          />
          <aside id="right" className="panel" aria-label="แจ้งเตือน">
            <div className="rhead">
              <h2 className="ptitle">แจ้งเตือน</h2>
              <div className="rtabs" role="tablist">
                {tabs.map(([k, label]) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={tab === k}
                    onClick={() => setRightTab(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rbody">
              {tab === 'inc' && (
                <Incidents
                  snap={snap}
                  layout={layout.data}
                  names={names}
                  current={sel?.kind === 'device' ? sel.code : null}
                  building={building}
                  now={now}
                  isFresh={(d) => feed.isFresh(d, now)}
                  onGo={go}
                  onClearBuilding={() => focus(null)}
                />
              )}
              {tab === 'hist' && historyPanel}
              {tab === 'unl' && unlocatedPanel}
            </div>
          </aside>
        </div>

        <Leaving show={help}>
          <Help
            fibers={fibers.map((f) => ({ color: f.color, text: f.text }))}
            demo={demoLabel}
            onClose={() => setHelp(false)}
            onTour={() => {
              setHelp(false);
              setTour(true);
            }}
          />
        </Leaving>
        {tour && <Tour onDone={() => setTour(false)} />}
      </div>
    </div>
  );
}
