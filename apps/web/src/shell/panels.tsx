// M20 side panels from the prototype, on real data: incidents grouped by root cause (+ planned
// maintenance), 24 h history (filtered by the focused building), devices without a position, and
// the computer labs of a building.
import {
  DEVICE_STATE_TH,
  downstreamOf,
  type HistoryEvent,
  type Layout,
  type StatusHistory,
  type StatusSnapshot,
  type UnlocatedList,
} from '@sbc-noc/shared';
import { STATE_ICON, type UiState } from '@sbc-noc/ui';
import { useState } from 'react';
import { deviceKind, type LabModel } from '../scene/model.js';
import {
  firstToHandle,
  ownCards,
  priority,
  PRIORITY_TH,
  rootGroup,
  splitIncidents,
  STALE_DAYS,
  type RootGroup,
} from './console.js';
import { plainMessage } from './messages.js';

/** What the device is, in words a teacher knows (shown before the location). */
const KIND_SHORT: Record<string, string> = {
  core: 'อุปกรณ์แกนกลาง',
  main: 'สวิตช์หลักอาคาร',
  access: 'สวิตช์ประจำชั้น',
  ap: 'Wi-Fi',
  nvr: 'เครื่องบันทึกกล้อง',
};

const MIN = 60_000;
/** "12 นาที", "2 ชม. 5 นาที", "3 วัน 4 ชม.", "149 วัน" — days once it is past a day. */
function minutesTxt(m: number): string {
  if (m < 60) return `${m} นาที`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชม. ${m % 60} นาที`;
  const d = Math.floor(h / 24);
  return d < 7 && h % 24 ? `${d} วัน ${h % 24} ชม.` : `${d} วัน`;
}
/** "เพิ่งเกิด", "12 นาที", "2 ชม. 5 นาที", "149 วัน" (prototype fmtAgo). */
export function fmtAgo(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / MIN));
  return m < 1 ? 'เพิ่งเกิด' : minutesTxt(m);
}
export function durTxt(a: string, b: string | number): string {
  const end = typeof b === 'number' ? b : Date.parse(b);
  return minutesTxt(Math.max(1, Math.round((end - Date.parse(a)) / MIN)));
}
/** Clock time, "เมื่อวาน hh:mm" for yesterday (prototype hhmm). */
export function hhmm(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const t = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? t : `เมื่อวาน ${t}`;
}
const fullTime = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

/** Helpers over the layout shared by the panels. */
export function makeNames(layout: Layout | undefined) {
  const dev = new Map((layout?.devices ?? []).map((d) => [d.code, d]));
  const bName = new Map((layout?.buildings ?? []).map((b) => [b.code, b.name]));
  const isWan = (code: string) => dev.get(code)?.role === 'wan';
  return {
    has: (code: string) => dev.has(code),
    name: (code: string) => {
      const d = dev.get(code);
      if (!d) return code;
      return isWan(code) ? `อินเทอร์เน็ต ${d.name}` : d.name;
    },
    where: (code: string) => {
      const d = dev.get(code);
      if (!d) return 'ยังไม่ระบุที่ตั้ง';
      if (!d.building) return isWan(code) ? 'อินเทอร์เน็ต' : 'ยังไม่ระบุที่ตั้ง';
      return `${bName.get(d.building) ?? d.building}${d.floor ? ` ชั้น ${d.floor}` : ''}`;
    },
    /** "สวิตช์หลักอาคาร · " — empty for internet links and unknown kinds. */
    kind: (code: string) => {
      const d = dev.get(code);
      const k = d ? deviceKind(d) : null;
      return k && KIND_SHORT[k] ? `${KIND_SHORT[k]} · ` : '';
    },
    building: (code: string) => dev.get(code)?.building ?? null,
    buildingName: (code: string) => bName.get(code) ?? code,
  };
}
export type Names = ReturnType<typeof makeNames>;

/** Incidents of one root cause each: P1–P3 cards, then warnings older than 7 days folded into one
 * group, then planned maintenance. Totals live only in the top bar. */
export function Incidents({
  snap,
  layout,
  names,
  current,
  building = null,
  now = Date.now(),
  isFresh = () => false,
  onGo,
  onClearBuilding,
}: {
  snap: StatusSnapshot | null;
  layout: Layout | undefined;
  names: Names;
  current: string | null;
  /** Focused building: only its incidents are listed. */
  building?: string | null;
  /** Clock for "12 นาที" (ticks between snapshots). */
  now?: number;
  /** Incident seen for the first time a moment ago (highlighted). */
  isFresh?: (device: string) => boolean;
  onGo: (code: string) => void;
  onClearBuilding?: () => void;
}) {
  const [staleOpen, setStaleOpen] = useState(false);
  if (!snap) return <p className="empty">รอข้อมูลสถานะ…</p>;
  const children = new Map<string, string[]>();
  for (const d of layout?.devices ?? [])
    if (d.uplink) children.set(d.uplink, [...(children.get(d.uplink) ?? []), d.code]);
  const go = (code: string) => (names.has(code) ? onGo(code) : undefined);
  const inBuilding = (code: string) => !building || names.building(code) === building;
  // followers sit inside their root cause's group; a group shows in every building it reaches
  const devices = layout?.devices ?? [];
  const groups = new Map(
    ownCards(snap.incidents)
      .filter((i) => i.severity === 'down' && i.impacted > 0)
      .map((i) => [i.device, rootGroup(snap, devices, i.device)]),
  );
  const reaches = (code: string) =>
    inBuilding(code) || (groups.get(code)?.buildings.some((b) => b.code === building) ?? false);
  const { main, stale } = splitIncidents(
    ownCards(snap.incidents).filter((i) => reaches(i.device)),
    now,
  );
  const maint = snap.maintenance.filter((m) => inBuilding(m.device));
  const showStale = staleOpen || stale.some((i) => i.device === current);
  return (
    <div data-testid="incidents">
      {building && onClearBuilding && (
        <button className="only" onClick={onClearBuilding} title="แสดงทุกอาคาร">
          เฉพาะ {names.buildingName(building)} ✕
        </button>
      )}
      {main.length === 0 && stale.length === 0 && (
        <div className="allok" data-testid="all-ok">
          <span className="okdot" aria-hidden="true" />
          <p className="empty">
            {building ? 'อาคารนี้ไม่มีแจ้งเตือน' : 'ไม่มีแจ้งเตือน ทุกระบบปกติ'}
          </p>
        </div>
      )}
      {main.map((i) => {
        const p = priority(i);
        return (
          <article
            key={i.device}
            className={`inc ${i.severity}${current === i.device ? ' cur' : ''}${isFresh(i.device) ? ' fresh' : ''}${i.ack ? ' acked' : ''}`}
            tabIndex={0}
            aria-label={`${p} ${DEVICE_STATE_TH[i.severity]} ${names.name(i.device)} ${names.where(i.device)}`}
            title="ไปที่อุปกรณ์ในภาพ 3D"
            data-go={i.device}
            onClick={() => go(i.device)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go(i.device);
            }}
          >
            <h3>
              <span className={`prio ${p}`} title={PRIORITY_TH[p]}>
                {p}
              </span>
              <span className="nm">{names.name(i.device)}</span>
              <span className="age" title={`เริ่มเมื่อ ${fullTime(i.since)}`}>
                {fmtAgo(i.since, now)}
              </span>
            </h3>
            <p title={plainMessage(i.message) !== i.message ? i.message : undefined}>
              {names.kind(i.device)}
              {names.where(i.device)} · {plainMessage(i.message)}
            </p>
            {(i.impacted > 0 || isFresh(i.device)) && (
              <div className="meta">
                {groups.get(i.device)?.dark.length ? (
                  <span className="impact">{darkTxt(groups.get(i.device) as RootGroup)}</span>
                ) : (
                  i.impacted > 0 && <span className="impact">กระทบ {i.impacted} อุปกรณ์</span>
                )}
                {isFresh(i.device) && <span className="newtag">ใหม่</span>}
              </div>
            )}
            {i.ack && (
              <div className="ack">
                ✓ รับเรื่องโดย {i.ack.by}
                {i.ack.note ? ` · ${i.ack.note}` : ''} ({fmtAgo(i.ack.at, now)}ที่แล้ว)
              </div>
            )}
          </article>
        );
      })}
      {stale.length > 0 && (
        <div className="staleg" data-testid="stale-group">
          <button
            className="staleh"
            aria-expanded={showStale}
            onClick={() => setStaleOpen(!showStale)}
            title={`ควรตรวจสอบ ค้างมานานกว่า ${STALE_DAYS} วัน`}
          >
            <span className="prio P3">P3 × {stale.length}</span>
            <span className="t">ค้างนานเกิน {STALE_DAYS} วัน</span>
            <span className="chev">{showStale ? 'ซ่อน' : 'ดู'}</span>
          </button>
          {showStale &&
            stale.map((i) => (
              <button
                key={i.device}
                className={`srow${current === i.device ? ' cur' : ''}`}
                data-go={i.device}
                onClick={() => go(i.device)}
                title={`${names.where(i.device)} · เริ่มเมื่อ ${fullTime(i.since)}`}
              >
                <span className="i warn">{STATE_ICON.warn}</span>
                <span className="tx">
                  <b>{names.name(i.device)}</b> · {plainMessage(i.message)}
                </span>
                <span className="age">{fmtAgo(i.since, now)}</span>
              </button>
            ))}
        </div>
      )}
      {maint.length > 0 && (
        <>
          <p className="sub2">อยู่ระหว่างบำรุงรักษา</p>
          {maint.map((m) => (
            <article
              key={m.device}
              className="inc maint"
              tabIndex={0}
              data-go={m.device}
              onClick={() => go(m.device)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') go(m.device);
              }}
            >
              <h3>
                <span className="i maint">{STATE_ICON.maint}</span>{' '}
                <span className="nm">{names.name(m.device)}</span>
              </h3>
              <p>
                {names.where(m.device)} · {m.message}
              </p>
              <div className="meta">
                <span>โดย {m.by}</span>
                <span>พักแจ้งเตือน {downstreamOf(children, m.device).size + 1} อุปกรณ์</span>
              </div>
            </article>
          ))}
        </>
      )}
    </div>
  );
}

/** "ดับตาม 21 ตัว ใน 6 อาคาร" */
const darkTxt = (g: RootGroup) =>
  `ดับตาม ${g.dark.length} ตัว${g.buildings.length > 1 ? ` ใน ${g.buildings.length} อาคาร` : ''}`;

/** "ทำอะไรก่อน": the first down root cause nobody has taken, with where to go and how to take it.
 * A root cause with devices out behind it shows them per building and as a folded list. */
export function FirstCard({
  snap,
  layout,
  names,
  demo,
  now = Date.now(),
  zabbixUrl,
  onGo,
}: {
  snap: StatusSnapshot | null;
  layout: Layout | undefined;
  names: Names;
  demo: boolean;
  now?: number;
  /** Zabbix page of the device (M22 link template); null when not set up. */
  zabbixUrl: (code: string) => string | null;
  onGo: (code: string) => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const i = snap ? firstToHandle(snap.incidents) : null;
  if (!snap || !i) return null;
  const p = priority(i);
  const url = zabbixUrl(i.device);
  const g = rootGroup(snap, layout?.devices ?? [], i.device);
  const group = g.dark.length > 0;
  return (
    <section
      id="first"
      className="panel"
      aria-label="ทำอะไรก่อน"
      data-testid="first"
      data-group={group ? g.dark.length : undefined}
    >
      <p className="fhead">
        <span className={`prio ${p}`} title={PRIORITY_TH[p]}>
          {p} {p === 'P1' ? 'วิกฤต' : 'สูง'}
        </span>
        <span className="lbl">{group ? 'ต้นเหตุ ทำอันนี้ก่อน' : 'ทำอะไรก่อน'}</span>
      </p>
      <h3>{names.name(i.device)} ใช้งานไม่ได้</h3>
      <p className="line">
        {names.kind(i.device)}
        {names.where(i.device)} · {plainMessage(i.message)} · {fmtAgo(i.since, now)}
        {!group && i.impacted > 0 ? ` · กระทบ ${i.impacted} อุปกรณ์` : ''}
      </p>
      {group && (
        <div className="grp" data-testid="root-group">
          <p className="gnote">{darkTxt(g)} — แก้ที่ต้นเหตุแล้วจะกลับมาเอง</p>
          <ul className="gchips">
            {g.buildings.map((b) => (
              <li key={b.code ?? '-'}>
                <span>{b.code ? names.buildingName(b.code) : 'ไม่ระบุอาคาร'}</span>
                <b className="mono">{b.n}</b>
              </li>
            ))}
          </ul>
          <button
            className="gtoggle"
            aria-expanded={listOpen}
            onClick={() => setListOpen(!listOpen)}
          >
            {listOpen ? 'ซ่อนรายชื่อ' : `ดูรายชื่อ ${g.dark.length} ตัว`}
          </button>
          {listOpen && (
            <ul className="glist mono">
              {g.dark.map((c) => (
                <li key={c}>
                  <button data-go={c} onClick={() => onGo(c)} title="ไปที่อุปกรณ์ในภาพ 3D">
                    <span>{names.name(c)}</span>
                    <span className="gb">
                      {snap.states[c] === 'down' ? 'ล่ม' : 'ขาดจากต้นทาง'} · {names.where(c)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="btns">
        {names.has(i.device) && (
          <button className="primary" onClick={() => onGo(i.device)}>
            ดูบนผัง
          </button>
        )}
        {url && !demo && (
          <a
            className="btnlink"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={group ? 'รับเรื่องที่ต้นเหตุ ทั้งกลุ่มนับว่ามีคนรับแล้ว' : undefined}
          >
            {group ? 'รับเรื่องทั้งกลุ่มใน Zabbix ↗' : 'รับเรื่องใน Zabbix ↗'}
          </a>
        )}
      </div>
      {!url && !demo && (
        <p className="hnote">
          รับเรื่องใน Zabbix (ขึ้นที่การ์ดภายใน 30 วินาที) —
          ปุ่มรับเรื่องในหน้านี้มาพร้อมระบบเข้าสู่ระบบ
        </p>
      )}
    </section>
  );
}

const EVT_TH: Record<HistoryEvent['severity'], string> = {
  down: 'ใช้งานไม่ได้',
  warn: 'ควรตรวจสอบ',
};

export function History({
  history,
  loading,
  names,
  building,
  onGo,
}: {
  history: StatusHistory | null | undefined;
  loading: boolean;
  names: Names;
  building: string | null;
  onGo: (code: string) => void;
}) {
  if (history === undefined && loading) return <p className="empty">กำลังโหลดประวัติ…</p>;
  if (!history)
    return (
      <p className="empty" data-testid="history">
        ยังไม่มีประวัติ — worker ยังไม่ได้อ่านเหตุการณ์จาก Zabbix (ผู้ใช้ API ต้องมีสิทธิ์
        event.get)
      </p>
    );
  const list = history.events.filter(
    (h) => !building || (h.device !== null && names.building(h.device) === building),
  );
  const now = Date.now();
  return (
    <div data-testid="history">
      <p className="hnote">
        {history.hours} ชั่วโมงล่าสุด{' '}
        {building ? `เฉพาะ ${names.buildingName(building)}` : 'ทั้งโรงเรียน'}
      </p>
      {list.length === 0 ? (
        <p className="empty">ไม่มีเหตุการณ์ใน {history.hours} ชั่วโมง</p>
      ) : (
        list.map((h, k) => {
          const known = h.device !== null && names.has(h.device);
          const nm = known ? names.name(h.device as string) : h.host;
          const where = known ? names.where(h.device as string) : 'ยังไม่ระบุที่ตั้ง';
          return (
            <div
              key={`${h.host}:${h.start}:${k}`}
              className={`hrow${known ? ' go' : ''}`}
              tabIndex={known ? 0 : undefined}
              onClick={() => known && onGo(h.device as string)}
              onKeyDown={(e) => {
                if (known && e.key === 'Enter') onGo(h.device as string);
              }}
            >
              <span className="tm" title={fullTime(h.start)}>
                {hhmm(h.start)}
              </span>
              <span className={`i ${h.severity}`}>{STATE_ICON[h.severity]}</span>
              <span className="tx">
                {nm} · {EVT_TH[h.severity]}
                <small>
                  {where} · {plainMessage(h.message)} ·{' '}
                  {h.end ? (
                    `กลับมาปกติ หลัง ${durTxt(h.start, h.end)}`
                  ) : (
                    <>
                      <span className="live">ยังไม่หาย</span> · {durTxt(h.start, now)}
                    </>
                  )}
                </small>
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

export function Unlocated({
  unlocated,
  unplaced,
  names,
  snap,
  onGo,
}: {
  unlocated: UnlocatedList | null | undefined;
  /** Registry devices with no building (not WAN). */
  unplaced: string[];
  names: Names;
  snap: StatusSnapshot | null;
  onGo: (code: string) => void;
}) {
  const hosts = unlocated?.hosts ?? [];
  return (
    <div data-testid="unlocated">
      <p className="hnote">
        host ใน Zabbix ที่ไม่ตรงกับอุปกรณ์ในทะเบียน จึงยังวางในภาพ 3D ไม่ได้ — เพิ่มในทะเบียน
        (หน้าจัดการ) ด้วย IP หรือชื่อ host เดียวกัน แล้วงานจับคู่จะผูกให้เองในรอบถัดไป
      </p>
      {unlocated === null ? (
        <p className="empty">ยังไม่มีรายการ — worker ยังไม่ได้อ่าน host จาก Zabbix</p>
      ) : unlocated === undefined ? (
        <p className="empty">กำลังโหลด…</p>
      ) : hosts.length === 0 ? (
        <p className="empty">host ใน Zabbix มีตำแหน่งครบ</p>
      ) : (
        hosts.map((u) => (
          <div key={u.hostid} className="urow">
            <b>
              <span className={`i ${u.state}`}>{STATE_ICON[u.state]}</span> {u.name}
            </b>
            <small>
              {[
                u.ip ?? 'ไม่มี IP',
                u.groups.length ? `กลุ่ม ${u.groups.join(', ')}` : null,
                DEVICE_STATE_TH[u.state],
              ]
                .filter(Boolean)
                .join(' · ')}
            </small>
          </div>
        ))
      )}
      {unplaced.length > 0 && (
        <>
          <p className="sub2">ในทะเบียนแต่ยังไม่ระบุอาคาร ({unplaced.length})</p>
          {unplaced.map((code) => {
            const st = (snap?.states[code] as UiState | undefined) ?? 'ok';
            return (
              <div
                key={code}
                className="urow go"
                tabIndex={0}
                onClick={() => onGo(code)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onGo(code);
                }}
              >
                <b>
                  <span className={`i ${st}`}>{STATE_ICON[st]}</span> {names.name(code)}
                </b>
                <small>
                  {code} · {DEVICE_STATE_TH[st]}
                </small>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

export const unlocatedCount = (u: UnlocatedList | null | undefined, unplaced: string[]) =>
  (u?.hosts.length ?? 0) + unplaced.length;

/** Computer labs of the focused building with PCs online (prototype .labs). */
export function Labs({
  labs,
  snap,
  onLab,
}: {
  labs: LabModel[];
  snap: StatusSnapshot | null;
  onLab: (locCode: string) => void;
}) {
  if (!labs.length) return null;
  return (
    <div className="labs" data-testid="labs">
      <p className="sub2">ห้องคอมฯ ในอาคารนี้</p>
      {[...labs]
        .sort((a, b) => a.floor - b.floor || a.name.localeCompare(b.name))
        .map((l) => {
          const on = snap?.labOnline[l.locCode];
          const pct = on !== undefined && l.pcs ? Math.min(100, Math.round((on / l.pcs) * 100)) : 0;
          return (
            <button key={l.locCode} className="labrow" onClick={() => onLab(l.locCode)}>
              ชั้น {l.floor} {l.name} ·{' '}
              {on !== undefined
                ? `${on}${l.pcs ? `/${l.pcs}` : ''} เครื่องออนไลน์`
                : `${l.pcs !== null ? `${l.pcs} เครื่อง · ` : ''}ยังไม่มีข้อมูลออนไลน์`}
              <span className="bar">
                <i style={{ width: `${pct}%` }} />
              </span>
            </button>
          );
        })}
    </div>
  );
}
