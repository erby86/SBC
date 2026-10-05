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
import { deviceKind, type LabModel } from '../scene/model.js';
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

export function Incidents({
  snap,
  layout,
  names,
  current,
  demo,
  now = Date.now(),
  isFresh = () => false,
  onGo,
  onNext,
}: {
  snap: StatusSnapshot | null;
  layout: Layout | undefined;
  names: Names;
  current: string | null;
  demo: string | null;
  /** Clock for "12 นาที" (ticks between snapshots). */
  now?: number;
  /** Incident seen for the first time a moment ago (highlighted). */
  isFresh?: (device: string) => boolean;
  onGo: (code: string) => void;
  /** Go to the next incident nobody has taken (key N). */
  onNext?: () => void;
}) {
  if (!snap) return <p className="empty">รอข้อมูลสถานะ…</p>;
  const downs = snap.incidents.filter((i) => i.severity === 'down').length;
  const warns = snap.incidents.length - downs;
  const children = new Map<string, string[]>();
  for (const d of layout?.devices ?? [])
    if (d.uplink) children.set(d.uplink, [...(children.get(d.uplink) ?? []), d.code]);
  const go = (code: string) => (names.has(code) ? onGo(code) : undefined);
  return (
    <div data-testid="incidents">
      {demo && <p className="demonote">{demo}</p>}
      {snap.incidents.length > 0 && (
        <div className="incsum">
          {downs > 0 && (
            <span className="pill down">
              {STATE_ICON.down} ใช้งานไม่ได้ {downs}
            </span>
          )}
          {warns > 0 && (
            <span className="pill warn">
              {STATE_ICON.warn} ควรตรวจสอบ {warns}
            </span>
          )}
          {onNext && (
            <button
              className="next"
              onClick={onNext}
              aria-label="ไปเหตุถัดไป"
              title="ไปเหตุถัดไปที่ยังไม่มีคนรับ (กด N)"
            >
              เหตุถัดไป <kbd>N</kbd>
            </button>
          )}
        </div>
      )}
      {snap.incidents.length === 0 ? (
        <div className="allok" data-testid="all-ok">
          <span className="okdot" aria-hidden="true" />
          <p className="empty">ไม่มีแจ้งเตือน ทุกระบบปกติ</p>
        </div>
      ) : (
        snap.incidents.map((i) => (
          <article
            key={i.device}
            className={`inc ${i.severity}${current === i.device ? ' cur' : ''}${isFresh(i.device) ? ' fresh' : ''}${i.ack ? ' acked' : ''}`}
            tabIndex={0}
            aria-label={`${DEVICE_STATE_TH[i.severity]} ${names.name(i.device)} ${names.where(i.device)}`}
            title="ไปที่อุปกรณ์ในภาพ 3D"
            data-go={i.device}
            onClick={() => go(i.device)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go(i.device);
            }}
          >
            <h3>
              <span className={`i ${i.severity}`}>{STATE_ICON[i.severity]}</span>{' '}
              {names.name(i.device)}
            </h3>
            <p title={plainMessage(i.message) !== i.message ? i.message : undefined}>
              {names.kind(i.device)}
              {names.where(i.device)} · {plainMessage(i.message)}
            </p>
            <div className="meta">
              <span title={`เริ่มเมื่อ ${fullTime(i.since)}`}>
                {DEVICE_STATE_TH[i.severity]} {fmtAgo(i.since, now)}
              </span>
              {i.impacted > 0 && <span className="impact">กระทบ {i.impacted} อุปกรณ์</span>}
              {isFresh(i.device) && <span className="newtag">ใหม่</span>}
            </div>
            {i.ack && (
              <div className="ack">
                ✓ รับเรื่องโดย {i.ack.by}
                {i.ack.note ? ` · ${i.ack.note}` : ''} ({fmtAgo(i.ack.at, now)}ที่แล้ว)
              </div>
            )}
          </article>
        ))
      )}
      {snap.maintenance.length > 0 && (
        <>
          <p className="sub2">อยู่ระหว่างบำรุงรักษา</p>
          {snap.maintenance.map((m) => (
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
                <span className="i maint">{STATE_ICON.maint}</span> {names.name(m.device)}
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
      {snap.incidents.some((i) => !i.ack) && !demo && (
        <p className="hnote">
          รับเรื่องใน Zabbix ไปก่อน (ขึ้นที่การ์ดภายใน 30 วินาที) —
          ปุ่มรับเรื่องในหน้านี้มาพร้อมระบบเข้าสู่ระบบ
        </p>
      )}
    </div>
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
