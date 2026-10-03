// M18: the screen frame from the prototype — top bar, buildings + mini map (left), 3D scene
// (centre), alerts/history/unlocated (right), layers + legend (bottom), and a bottom sheet
// with tabs on phones. Panels read real data (layout from M14, live status from M16).
// M19: the 3D scene (Scene3D → scene/NocScene.ts) with building focus, floor cut, top view,
// fly-to from incidents, device details, mini map and eco mode. Search, history, TV mode: M20.
import { DEVICE_STATE_TH, type Layout, type StatusSnapshot } from '@sbc-noc/shared';
import { LAYERS, STATE_ICON, type LayerKey, type UiState } from '@sbc-noc/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useLayout } from '../data/api.js';
import { defaultWsUrl, useLiveStatus, type LiveMode } from '../data/live.js';
import { buildSceneModel, deviceKind, type SceneModel } from '../scene/model.js';
import type { NocScene, Selection } from '../scene/NocScene.js';
import { Scene3D, saveEco, savedEco, useHint } from './Scene3D.js';

type RightTab = 'inc' | 'hist' | 'unl';
type SheetTab = 'inc' | 'bld' | 'hist' | 'find';

const timeTh = (iso: string) =>
  new Date(iso).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

interface ViewControls {
  ready: boolean;
  top: boolean;
  eco: boolean;
  fps: number | null;
  onTop: () => void;
  onHome: () => void;
  onEco: () => void;
}

function TopBar({
  snap,
  mode,
  view,
  onBigNum,
}: {
  snap: StatusSnapshot | null;
  mode: LiveMode;
  view: ViewControls;
  onBigNum: () => void;
}) {
  const open = snap?.incidents.filter((i) => !i.ack).length ?? 0;
  const c = snap?.counts;
  return (
    <header id="top" className="panel">
      <h1>SB School NOC</h1>
      <button
        id="bigNum"
        className={open ? 'hot' : ''}
        title="เหตุที่ยังไม่มีคนรับเรื่อง"
        data-testid="open-incidents"
        onClick={onBigNum}
      >
        <b>{open}</b>
        <span>ยังไม่มีคนรับ</span>
      </button>
      <div className="sbox">
        <input
          id="search"
          type="search"
          placeholder="ค้นหา ตึก ชั้น อุปกรณ์ IP ( / )"
          aria-label="ค้นหา"
          disabled
        />
      </div>
      <div className="chips" aria-live="polite" data-testid="state-chips">
        {c &&
          (['down', 'warn', 'cut', 'maint'] as const)
            .filter((k) => c[k] > 0)
            .map((k) => (
              <span key={k} className="chip">
                <span className={`i ${k}`}>{STATE_ICON[k]}</span>
                {k === 'down'
                  ? 'ล่ม'
                  : k === 'warn'
                    ? 'เตือน'
                    : k === 'cut'
                      ? 'ขาดจากต้นทาง'
                      : 'บำรุงรักษา'}{' '}
                {c[k]}
              </span>
            ))}
      </div>
      <span
        className={`chip${snap?.stale ? ' stale' : ''}`}
        id="fresh"
        data-testid="fresh"
        title={mode === 'live' ? 'รับข้อมูลสดผ่าน WebSocket' : 'ดึงข้อมูลทุก 30 วินาที'}
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
        <button className="wide" disabled title="มาใน M20">
          โหมดทีวี
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
    const st = (snap?.states[d.code] as UiState | undefined) ?? 'ok';
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
  snap,
  selected,
  floor,
  onSelect,
  onFloor,
}: {
  layout: Layout | undefined;
  snap: StatusSnapshot | null;
  selected: string | null;
  floor: number | null;
  onSelect: (code: string | null) => void;
  onFloor: (floor: number | null) => void;
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
        </div>
      )}
    </>
  );
}

function Incidents({
  snap,
  names,
  current,
  onGo,
}: {
  snap: StatusSnapshot | null;
  names: Map<string, string>;
  current: string | null;
  onGo: (code: string) => void;
}) {
  if (!snap) return <p className="empty">รอข้อมูลสถานะ…</p>;
  if (snap.incidents.length === 0) return <p className="empty">ไม่มีเหตุ ทุกอย่างปกติ</p>;
  return (
    <div data-testid="incidents">
      {snap.incidents.map((i) => (
        <article
          key={i.device}
          className={`inc ${i.severity}${current === i.device ? ' cur' : ''}`}
          tabIndex={0}
          title="ไปที่อุปกรณ์ในภาพ 3D"
          onClick={() => onGo(i.device)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onGo(i.device);
          }}
        >
          <h3>
            <span className={`i ${i.severity}`}>{STATE_ICON[i.severity]}</span>{' '}
            {names.get(i.device) ?? i.device}
          </h3>
          <p>{i.message}</p>
          <div className="meta">
            <span>ตั้งแต่ {timeTh(i.since)}</span>
            {i.impacted > 0 && <span>กระทบ {i.impacted} อุปกรณ์</span>}
          </div>
          {i.ack && (
            <div className="ack">
              รับเรื่องแล้ว · {i.ack.by}
              {i.ack.note ? ` · ${i.ack.note}` : ''}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

const Later = ({ what }: { what: string }) => <p className="empty">{what} — มาใน M20</p>;

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

/** Details of the clicked device or lab (prototype #info). */
function InfoPanel({
  sel,
  layout,
  model,
  snap,
  onClose,
}: {
  sel: Selection;
  layout: Layout;
  model: SceneModel;
  snap: StatusSnapshot | null;
  onClose: () => void;
}) {
  const bName = (code: string | null) =>
    layout.buildings.find((b) => b.code === code)?.name ?? code ?? '';
  let title: string;
  let sub: string;
  let rows: [string, React.ReactNode][];
  if (sel.kind === 'device') {
    // details come from the registry, so a device that is not drawn (no shape) still shows
    const d = layout.devices.find((x) => x.code === sel.code);
    if (!d) return null;
    const kind = deviceKind(d);
    const st = kind === 'planned' ? null : ((snap?.states[d.code] as UiState) ?? 'ok');
    const inc = snap?.incidents.find((i) => i.device === d.code);
    const up = d.uplink ? layout.devices.find((x) => x.code === d.uplink) : undefined;
    const down = layout.devices.filter((x) => x.uplink === d.code).length;
    title = d.name;
    sub = `${(kind && KIND_TH[kind]) ?? d.role}${d.building ? ` · ${bName(d.building)}${d.floor ? ` ชั้น ${d.floor}` : ''}` : ''}`;
    rows = [
      [
        'สถานะ',
        st ? (
          <>
            <span className={`i ${st}`}>{STATE_ICON[st]}</span> {DEVICE_STATE_TH[st]}
          </>
        ) : (
          <>
            <span className="i maint">{STATE_ICON.maint}</span> ยังไม่ติดตั้ง
          </>
        ),
      ],
      ['อาการ', inc?.message],
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
    title = lab.name;
    sub = `${bName(lab.building)} ชั้น ${lab.floor} · ${lab.locCode}`;
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
      <div className="links">
        <button disabled title="เชื่อมใน M22">
          เปิดใน Zabbix
        </button>
        <button disabled title="เชื่อมใน M22">
          กราฟ (Grafana)
        </button>
      </div>
    </section>
  );
}

/** Fibre colours of the scene with the route of their cable (registry). */
function FiberLegend({ model, layout }: { model: SceneModel | null; layout: Layout | undefined }) {
  const fibers = (model?.links ?? []).filter((l) => l.kind === 'fiber');
  if (!fibers.length) return null;
  const route = (code: string | null) => layout?.cables.find((c) => c.code === code)?.route;
  const name = (code: string) => layout?.devices.find((d) => d.code === code)?.name ?? code;
  return (
    <details className="fibers">
      <summary>ไฟเบอร์ ▾</summary>
      <div id="fiberLegend" className="panel" data-testid="fiber-legend">
        <b>ไฟเบอร์</b>
        {fibers.map((f) => (
          <span key={f.key}>
            <i className="fl" style={{ background: f.color ?? undefined }} />
            {route(f.cable) ?? `${name(f.a)} → ${name(f.b)}`}
            {f.cable ? <small> · {f.cable}</small> : null}
          </span>
        ))}
      </div>
    </details>
  );
}

const showFps = () => {
  try {
    return new URLSearchParams(location.search).has('fps');
  } catch {
    return false;
  }
};

export function NocShell() {
  const layout = useLayout();
  const { snapshot: snap, mode } = useLiveStatus(defaultWsUrl());
  const [rightTab, setRightTab] = useState<RightTab>('inc');
  const [sheetTab, setSheetTab] = useState<SheetTab>('inc');
  const [sheetMin, setSheetMin] = useState(false);
  const [building, setBuilding] = useState<string | null>(null);
  const [floor, setFloor] = useState<number | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [top, setTop] = useState(false);
  const [eco, setEco] = useState(savedEco);
  const [fps, setFps] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(
    Object.fromEntries(LAYERS.map((l) => [l.key, true])) as Record<LayerKey, boolean>,
  );
  const [scene, setScene] = useState<NocScene | null>(null);
  const [mini, setMini] = useState<HTMLCanvasElement | null>(null);
  const fpsOn = useRef(showFps());
  const hint = useHint();
  const model = useMemo(() => (layout.data ? buildSceneModel(layout.data) : null), [layout.data]);
  const names = new Map((layout.data?.devices ?? []).map((d) => [d.code, d.name]));
  const incCount = snap?.incidents.length ?? 0;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const focus = (code: string | null, f: number | null = null) => {
    setBuilding(code);
    setFloor(f);
    setTop(false);
    scene?.focus(code, f);
  };
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
  const go = (code: string) => {
    const m = model?.devices.find((d) => d.code === code);
    const next: Selection = { kind: 'device', code };
    setSel(next);
    if (m?.building) {
      const b = model?.buildings.find((x) => x.code === m.building);
      setBuilding(m.building);
      setFloor(b && b.floors > 1 ? m.floor : null);
    }
    scene?.select(next);
  };
  const onSelect = useCallback(
    (s: Selection | null) => {
      setSel(s);
    },
    [setSel],
  );
  const view: ViewControls = {
    ready: !!scene,
    top,
    eco,
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
  };
  const closeInfo = () => {
    setSel(null);
    scene?.select(null, false);
  };

  return (
    <div id="app" className={snap?.stale ? 'stale' : ''}>
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
          mode={mode}
          view={view}
          onBigNum={() => {
            setRightTab('inc');
            setSheetTab('inc');
            setSheetMin(false);
          }}
        />

        <div id="leftcol">
          <nav id="left" className="panel" aria-label="อาคาร">
            <p className="ptitle">อาคาร</p>
            <BuildingList
              layout={layout.data}
              snap={snap}
              selected={building}
              floor={floor}
              onSelect={(c) => focus(c)}
              onFloor={onFloor}
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
          {hint.show && scene && <p id="hint">{hint.text}</p>}
          {toast && (
            <div id="toast" role="status">
              {toast}
            </div>
          )}
          {sel && layout.data && model && (
            <InfoPanel
              sel={sel}
              layout={layout.data}
              model={model}
              snap={snap}
              onClose={closeInfo}
            />
          )}
        </main>

        <aside id="right" className="panel" aria-label="แจ้งเตือน">
          <div className="rtabs" role="tablist">
            {(
              [
                ['inc', `แจ้งเตือน ${incCount || ''}`],
                ['hist', 'ประวัติ'],
                ['unl', 'ไม่มีตำแหน่ง'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={rightTab === k}
                onClick={() => setRightTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
          {rightTab === 'inc' && (
            <Incidents
              snap={snap}
              names={names}
              current={sel?.kind === 'device' ? sel.code : null}
              onGo={go}
            />
          )}
          {rightTab === 'hist' && <Later what="ประวัติ 24 ชั่วโมง" />}
          {rightTab === 'unl' && <Later what="host ใน Zabbix ที่ไม่มีตำแหน่ง" />}
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
          <FiberLegend model={model} layout={layout.data} />
          <span className="stlegend" title="ความหมายสัญลักษณ์สถานะ">
            <span className="i ok">{STATE_ICON.ok}</span>ปกติ{' '}
            <span className="i warn">{STATE_ICON.warn}</span>เตือน{' '}
            <span className="i down">{STATE_ICON.down}</span>ล่ม{' '}
            <span className="i cut">{STATE_ICON.cut}</span>
            ขาดจากต้นทาง <span className="i maint">{STATE_ICON.maint}</span>บำรุงรักษา
          </span>
        </footer>

        <section id="sheet" className={`panel${sheetMin ? ' min' : ''}`} aria-label="แผงข้อมูล">
          <div className="tabs" role="tablist">
            {(
              [
                ['inc', `แจ้งเตือน ${incCount || ''}`],
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
              aria-label="ย่อ/ขยาย"
              aria-expanded={!sheetMin}
              onClick={() => setSheetMin(!sheetMin)}
            >
              {sheetMin ? '▴' : '▾'}
            </button>
          </div>
          <div className="tabbody">
            {sheetTab === 'inc' && (
              <Incidents
                snap={snap}
                names={names}
                current={sel?.kind === 'device' ? sel.code : null}
                onGo={(c) => {
                  go(c);
                  setSheetMin(true);
                }}
              />
            )}
            {sheetTab === 'bld' && (
              <BuildingList
                layout={layout.data}
                snap={snap}
                selected={building}
                floor={floor}
                onSelect={(c) => focus(c)}
                onFloor={onFloor}
              />
            )}
            {sheetTab === 'hist' && <Later what="ประวัติ 24 ชั่วโมง" />}
            {sheetTab === 'find' && <Later what="ค้นหา" />}
          </div>
        </section>
      </div>
    </div>
  );
}
