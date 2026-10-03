// M18: the screen frame from the prototype — top bar, buildings + mini map (left), 3D scene
// (centre, M19), alerts/history/unlocated (right), layers + legend (bottom), and a bottom sheet
// with tabs on phones. Panels already read real data (layout from M14, live status from M16);
// richer behaviour (search, fly-to, history, TV mode) arrives with M19–M20.
import type { Layout, StatusSnapshot } from '@sbc-noc/shared';
import { LAYERS, STATE_ICON, type LayerKey } from '@sbc-noc/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { useLayout } from '../data/api.js';
import { defaultWsUrl, useLiveStatus, type LiveMode } from '../data/live.js';

type RightTab = 'inc' | 'hist' | 'unl';
type SheetTab = 'inc' | 'bld' | 'hist' | 'find';

const timeTh = (iso: string) =>
  new Date(iso).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

function TopBar({ snap, mode }: { snap: StatusSnapshot | null; mode: LiveMode }) {
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
      <div className="topbtns">
        <button className="wide" disabled title="มาพร้อมฉาก 3D (M19)">
          มุมบน
        </button>
        <button disabled title="มาพร้อมฉาก 3D (M19)">
          ทั้งโรงเรียน
        </button>
        <button className="wide" disabled title="มาใน M20">
          โหมดทีวี
        </button>
        <Link to="/admin" className="btnlink">
          จัดการ
        </Link>
      </div>
    </header>
  );
}

function BuildingList({
  layout,
  selected,
  onSelect,
}: {
  layout: Layout | undefined;
  selected: string | null;
  onSelect: (code: string | null) => void;
}) {
  if (!layout) return <p className="empty">กำลังโหลดผัง…</p>;
  const devicesIn = (b: string) => layout.devices.filter((d) => d.building === b).length;
  return (
    <ul className="blist" data-testid="buildings">
      {layout.buildings.map((b) => (
        <li key={b.code}>
          <button
            aria-current={selected === b.code}
            onClick={() => onSelect(selected === b.code ? null : b.code)}
          >
            {b.name}
            <span className="n">
              {b.floorCount} ชั้น · {devicesIn(b.code)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Incidents({ snap, names }: { snap: StatusSnapshot | null; names: Map<string, string> }) {
  if (!snap) return <p className="empty">รอข้อมูลสถานะ…</p>;
  if (snap.incidents.length === 0) return <p className="empty">ไม่มีเหตุ ทุกอย่างปกติ</p>;
  return (
    <div data-testid="incidents">
      {snap.incidents.map((i) => (
        <article key={i.device} className={`inc ${i.severity}`} tabIndex={0}>
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

export function NocShell() {
  const layout = useLayout();
  const { snapshot: snap, mode } = useLiveStatus(defaultWsUrl());
  const [rightTab, setRightTab] = useState<RightTab>('inc');
  const [sheetTab, setSheetTab] = useState<SheetTab>('inc');
  const [sheetMin, setSheetMin] = useState(false);
  const [building, setBuilding] = useState<string | null>(null);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(
    Object.fromEntries(LAYERS.map((l) => [l.key, true])) as Record<LayerKey, boolean>,
  );
  const names = new Map((layout.data?.devices ?? []).map((d) => [d.code, d.name]));
  const incCount = snap?.incidents.length ?? 0;

  return (
    <div id="app" className={snap?.stale ? 'stale' : ''}>
      <div id="ui">
        <TopBar snap={snap} mode={mode} />

        <div id="leftcol">
          <nav id="left" className="panel" aria-label="อาคาร">
            <p className="ptitle">อาคาร</p>
            <BuildingList layout={layout.data} selected={building} onSelect={setBuilding} />
          </nav>
          <figure id="miniBox" className="panel">
            <figcaption>
              แผนที่ย่อ <small>มาพร้อมฉาก 3D</small>
            </figcaption>
            <div id="mini" role="img" aria-label="แผนที่ย่อ (ยังไม่พร้อม)" />
          </figure>
        </div>

        <main id="center" aria-label="ผัง 3 มิติ">
          {snap?.stale && (
            <div id="staleBar" role="alert">
              ข้อมูลค้าง — ไม่ได้รับข้อมูลใหม่จาก Zabbix ตั้งแต่ {timeTh(snap.lastUpdate)}{' '}
              สถานะที่เห็นอาจไม่ตรงความจริง
            </div>
          )}
          <div id="scene" data-testid="scene-slot">
            <p>
              ฉาก 3D (M19)
              {layout.data &&
                ` · อาคาร ${layout.data.buildings.length} · ห้อง ${layout.data.locations.length} · อุปกรณ์ ${layout.data.devices.length}`}
              {building &&
                ` · เลือก ${layout.data?.buildings.find((b) => b.code === building)?.name ?? building}`}
            </p>
          </div>
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
          {rightTab === 'inc' && <Incidents snap={snap} names={names} />}
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
            {sheetTab === 'inc' && <Incidents snap={snap} names={names} />}
            {sheetTab === 'bld' && (
              <BuildingList layout={layout.data} selected={building} onSelect={setBuilding} />
            )}
            {sheetTab === 'hist' && <Later what="ประวัติ 24 ชั่วโมง" />}
            {sheetTab === 'find' && <Later what="ค้นหา" />}
          </div>
        </section>
      </div>
    </div>
  );
}
