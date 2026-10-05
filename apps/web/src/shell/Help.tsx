// M20 "วิธีใช้" dialog and first-visit tour (prototype buildHelp / TOUR). The tour runs once per
// browser (localStorage noc-tour) and never in TV mode; "?" opens the help, Esc closes.
import { STATE_ICON } from '@sbc-noc/ui';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const SHAPES: [string, ReactNode, string][] = [
  [
    'main',
    <svg key="m" width="16" height="16" viewBox="0 0 16 16">
      <path d="M8 1 15 8 8 15 1 8Z" fill="var(--main)" />
    </svg>,
    'main ของอาคาร',
  ],
  [
    'core',
    <svg key="c" width="18" height="12" viewBox="0 0 18 12">
      <rect x="1" y="3" width="16" height="7" fill="var(--core)" />
    </svg>,
    'อุปกรณ์แกนกลาง (ห้อง server)',
  ],
  [
    'access',
    <svg key="a" width="18" height="10" viewBox="0 0 18 10">
      <rect x="2" y="3" width="14" height="4" fill="var(--access)" />
    </svg>,
    'สวิตช์ประจำชั้น',
  ],
  [
    'ap',
    <svg key="ap" width="18" height="10" viewBox="0 0 18 10">
      <ellipse cx="9" cy="5" rx="7" ry="3" fill="var(--ap)" />
    </svg>,
    'Access Point (Wi-Fi) ใต้เพดาน',
  ],
  [
    'nvr',
    <svg key="n" width="12" height="16" viewBox="0 0 12 16">
      <rect x="2" y="2" width="8" height="12" rx="4" fill="var(--nvr)" />
    </svg>,
    'NVR กล้องวงจรปิด',
  ],
  [
    'lab',
    <svg key="l" width="18" height="10" viewBox="0 0 18 10">
      <rect x="1" y="4" width="16" height="3" fill="var(--lab)" />
    </svg>,
    'ห้องคอมพิวเตอร์ (แผ่นละ 1 ห้อง สีเทา = ไม่มีเครื่องออนไลน์)',
  ],
  [
    'wan',
    <svg key="w" width="16" height="16" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="7" fill="var(--wan)" />
    </svg>,
    'อินเทอร์เน็ต (ISP)',
  ],
  [
    'planned',
    <svg key="p" width="16" height="16" viewBox="0 0 16 16">
      <path d="M8 1 15 8 8 15 1 8Z" fill="none" stroke="var(--planned)" />
    </svg>,
    'controller ที่วางแผนไว้ (ยังไม่ติดตั้ง)',
  ],
];

const Kbd = ({ k }: { k: string }) => <kbd>{k}</kbd>;

export function Help({
  fibers,
  demo,
  onClose,
  onTour,
}: {
  fibers: { color: string | null; text: string }[];
  /** Demo label when the page shows a scenario. */
  demo: string | null;
  onClose: () => void;
  onTour: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  return (
    <section
      id="help"
      className="panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="helpTitle"
      data-testid="help"
    >
      <button ref={close} className="close" onClick={onClose}>
        ปิด
      </button>
      <h2 id="helpTitle">วิธีใช้ SB School NOC</h2>
      <h3>สัญลักษณ์สถานะ</h3>
      <table>
        <tbody>
          <tr>
            <td>
              <span className="i ok">{STATE_ICON.ok}</span> ปกติ
            </td>
            <td>ทำงานปกติ</td>
          </tr>
          <tr>
            <td>
              <span className="i warn">{STATE_ICON.warn}</span> เตือน
            </td>
            <td>ยังใช้งานได้แต่ผิดปกติ เช่น latency สูง, packet loss</td>
          </tr>
          <tr>
            <td>
              <span className="i down">{STATE_ICON.down}</span> ล่ม
            </td>
            <td>ไม่ตอบสนอง เป็นต้นเหตุ ต้องแก้ที่จุดนี้</td>
          </tr>
          <tr>
            <td>
              <span className="i cut">{STATE_ICON.cut}</span> ขาดจากต้นทาง
            </td>
            <td>ตัวเองอาจปกติ แต่อุปกรณ์ต้นทางล่ม จึงติดต่อไม่ได้ แก้ต้นเหตุแล้วจะกลับมาเอง</td>
          </tr>
          <tr>
            <td>
              <span className="i maint">{STATE_ICON.maint}</span> บำรุงรักษา
            </td>
            <td>ตั้งใจปิดตามแผน (maintenance ใน Zabbix) ไม่นับเป็นแจ้งเตือน</td>
          </tr>
        </tbody>
      </table>
      <h3>ในภาพ 3D</h3>
      <table>
        <tbody>
          {SHAPES.map(([k, svg, t]) => (
            <tr key={k}>
              <td>{svg}</td>
              <td>{t}</td>
            </tr>
          ))}
          <tr>
            <td>
              <span className="i down">│</span> ลำแสงแดง
            </td>
            <td>ตำแหน่งอุปกรณ์ที่ล่ม มองเห็นได้จากไกล</td>
          </tr>
          <tr>
            <td>
              <span className="i down">◯</span> วงคลื่น
            </td>
            <td>แดง = ล่ม, เหลือง = เตือน</td>
          </tr>
          <tr>
            <td>
              <span className="i down">▢</span> เงาแดงคลุมตึก
            </td>
            <td>ตึกนี้ได้รับผลกระทบ (ไม่ได้แปลว่าล่มทั้งตึก)</td>
          </tr>
          <tr>
            <td>
              <span className="ring" /> หน้าชื่อตึก
            </td>
            <td>สถานะรวมของตึกนั้น</td>
          </tr>
        </tbody>
      </table>
      {fibers.length > 0 && (
        <>
          <h3>สีไฟเบอร์</h3>
          <table>
            <tbody>
              {fibers.map((f) => (
                <tr key={f.text}>
                  <td>
                    <i className="fl" style={{ background: f.color ?? undefined }} />
                  </td>
                  <td>{f.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h3>การควบคุม</h3>
      <table>
        <tbody>
          <tr>
            <td>เมาส์</td>
            <td>ลากหมุน · ล้อซูม · คลิกขวาลากเลื่อน · คลิกอุปกรณ์ดูรายละเอียด</td>
          </tr>
          <tr>
            <td>จอสัมผัส</td>
            <td>นิ้วเดียวหมุน · สองนิ้วถ่างซูม · สองนิ้วลากเลื่อน · แตะอุปกรณ์ดูรายละเอียด</td>
          </tr>
          <tr>
            <td>แป้นพิมพ์</td>
            <td>
              <Kbd k="/" /> หรือ <Kbd k="Ctrl" />+<Kbd k="K" /> ค้นหา · <Kbd k="?" /> วิธีใช้ ·{' '}
              <Kbd k="Esc" /> ปิดแผง · <Kbd k="Tab" /> ไล่การ์ดแจ้งเตือน แล้ว <Kbd k="Enter" />{' '}
              เพื่อไปที่จุดนั้น · ลูกศรบนแผนที่ย่อเพื่อเลื่อนมุมกล้อง
            </td>
          </tr>
        </tbody>
      </table>
      <h3>แผงต่างๆ</h3>
      <table>
        <tbody>
          <tr>
            <td>ตัวเลขใหญ่แถบบน</td>
            <td>จำนวนเหตุที่ยังไม่มีคนรับเรื่อง</td>
          </tr>
          <tr>
            <td>แจ้งเตือน</td>
            <td>
              รวมตามต้นเหตุ บอกจำนวนอุปกรณ์ที่ได้รับผลกระทบ — ตอนนี้รับเรื่องใน Zabbix
              (ปุ่มรับเรื่องในหน้านี้มาพร้อมระบบเข้าสู่ระบบ)
            </td>
          </tr>
          <tr>
            <td>ประวัติ</td>
            <td>เหตุการณ์ 24 ชั่วโมงจาก Zabbix กรองตามตึกที่เลือกอัตโนมัติ</td>
          </tr>
          <tr>
            <td>ไม่มีตำแหน่ง</td>
            <td>host ใน Zabbix ที่ไม่ตรงกับทะเบียน และอุปกรณ์ในทะเบียนที่ยังไม่ระบุอาคาร</td>
          </tr>
          <tr>
            <td>อาคาร / ชั้น</td>
            <td>
              เลือกตึกเพื่อโฟกัส เลือกชั้นแล้วชั้นด้านบนจะซ่อนชั่วคราว กด &quot;ทุกชั้น&quot;
              เพื่อแสดงครบ · ห้องคอมฯ ของตึกอยู่ใต้ปุ่มชั้น
            </td>
          </tr>
          <tr>
            <td>ค้นหา</td>
            <td>
              พิมพ์หลายคำได้ เช่น ap 8 เซียน 6, nvr icet1, ล่ม, LOC-050, IP ·
              &quot;ไฮไลต์ในภาพ&quot; แสดงเฉพาะที่พบ
            </td>
          </tr>
          <tr>
            <td>แผนที่ย่อ</td>
            <td>
              กรอบฟ้า = พื้นที่ที่เห็นอยู่ในภาพ 3D ลูกศรชี้ทิศที่มอง · ✕ ล่ม ▲ เตือน · N ทิศเหนือ ·
              คลิกเพื่อย้ายมุมมอง
            </td>
          </tr>
          <tr>
            <td>อัปเดต hh:mm:ss</td>
            <td>เวลาได้ข้อมูลล่าสุด ถ้าค้างเกิน 2 นาที ภาพจะเป็นสีเทาพร้อมแถบแดงเตือน</td>
          </tr>
          <tr>
            <td>โหมดทีวี</td>
            <td>
              เต็มจอ ขยายทั้งหน้า วนแจ้งเตือนที่ยังไม่มีคนรับจุดละ 10 วินาที
              มีเสียงเมื่อมีเหตุล่มใหม่ · เปิดตรงด้วย /?tv
            </td>
          </tr>
          <tr>
            <td>โหมดประหยัด</td>
            <td>ปิดแสงเรืองและหางแสงสำหรับเครื่องกราฟิกไม่แรง (เปิดให้อัตโนมัติถ้าภาพกระตุก)</td>
          </tr>
        </tbody>
      </table>
      {demo && (
        <>
          <h3 id="demoHelp">โหมดสาธิต</h3>
          <p className="hp">
            {demo} — สถานการณ์ตัวอย่างจากต้นแบบ ใช้อบรมและทดลอง
            สถานะทั้งหมดในหน้านี้ไม่ได้มาจากเครือข่ายจริง กด &quot;ออกจากโหมดสาธิต&quot;
            ที่แถบสีเหลืองเพื่อกลับไปดูของจริง
          </p>
        </>
      )}
      <div className="row">
        <button onClick={onTour}>เริ่มแนะนำการใช้งานอีกครั้ง</button>
        <button onClick={onClose}>ปิด</button>
      </div>
    </section>
  );
}

export const TOUR_KEY = 'noc-tour';
export const tourSeen = () => {
  try {
    return localStorage.getItem(TOUR_KEY) === '1';
  } catch {
    return true; // no storage: do not nag on every load
  }
};
const markSeen = () => {
  try {
    localStorage.setItem(TOUR_KEY, '1');
  } catch {
    /* ignore */
  }
};

const mobile = () => typeof matchMedia === 'function' && matchMedia('(max-width: 900px)').matches;

const STEPS: { sel: () => string; t: string; p: string }[] = [
  {
    sel: () => (mobile() ? '#sheet' : '#right'),
    t: 'แจ้งเตือน',
    p: 'เหตุที่ต้องดูเรียงตามความรุนแรง ล่มอยู่บนสุด คลิกการ์ดเพื่อบินไปที่จุดนั้นในภาพ 3D',
  },
  {
    sel: () => (mobile() ? '#sheet' : '#left'),
    t: 'อาคารและชั้น',
    p: 'เลือกตึกเพื่อโฟกัส แล้วเลือกชั้นที่ต้องการ ชั้นด้านบนจะซ่อนชั่วคราว กด "ทุกชั้น" เพื่อแสดงครบ',
  },
  {
    sel: () => '#center',
    t: 'ภาพ 3D',
    p: 'ลากเพื่อหมุน ล้อเมาส์ซูม คลิกอุปกรณ์ดูรายละเอียด · ลำแสงแดงคือจุดที่ล่ม เงาแดงคลุมตึกคือตึกที่ได้รับผลกระทบ',
  },
  {
    sel: () => (mobile() ? '#top' : '.sbox'),
    t: 'ค้นหา',
    p: 'กด / แล้วพิมพ์ชื่อตึก ชั้น ห้อง อุปกรณ์ หรือ IP ได้หลายคำพร้อมกัน',
  },
  {
    sel: () => '#bigNum',
    t: 'ยังไม่มีคนรับ',
    p: 'ตัวเลขนี้คือเหตุที่ยังไม่มีคนรับเรื่อง (ตอนนี้รับเรื่องใน Zabbix) ดูวิธีใช้ทั้งหมดได้ที่ปุ่ม ?',
  },
];

export function Tour({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const step = STEPS[i];

  const finish = () => {
    markSeen();
    onDone();
  };

  useLayoutEffect(() => {
    if (!step) return;
    const ui = document.getElementById('ui')?.getBoundingClientRect();
    const tgt = document.querySelector<HTMLElement>(step.sel());
    const b = box.current;
    if (!ui || !b) return;
    const bw = b.offsetWidth || 300;
    const bh = b.offsetHeight || 140;
    let x = ui.width / 2 - bw / 2;
    let y = ui.height / 2 - bh / 2;
    if (tgt && tgt.offsetParent !== null) {
      tgt.classList.add('tourOn');
      const r = tgt.getBoundingClientRect();
      const rx = r.left - ui.left;
      const ry = r.top - ui.top;
      if (step.sel() === '#center') {
        x = rx + 12;
        y = ry + 12;
      } else if (rx + r.width + bw + 16 < ui.width) {
        x = rx + r.width + 12;
        y = ry;
      } else if (rx - bw - 12 > 0) {
        x = rx - bw - 12;
        y = ry;
      } else {
        x = rx;
        y = ry > ui.height / 2 ? ry - bh - 12 : ry + r.height + 12;
      }
    }
    setPos({
      left: Math.max(8, Math.min(ui.width - bw - 8, x)),
      top: Math.max(8, Math.min(ui.height - bh - 8, y)),
    });
    b.querySelector<HTMLButtonElement>('[data-next]')?.focus();
    return () => tgt?.classList.remove('tourOn');
  }, [step]);

  if (!step) return null;
  const lastStep = i === STEPS.length - 1;
  return (
    <div id="tour">
      <div
        id="tourBox"
        ref={box}
        className="panel"
        role="dialog"
        aria-live="polite"
        aria-label={`แนะนำการใช้งาน: ${step.t}`}
        data-testid="tour"
        style={pos ?? { visibility: 'hidden' }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') finish();
        }}
      >
        <h3>{step.t}</h3>
        <p>{step.p}</p>
        <div className="row">
          <span className="step">
            {i + 1}/{STEPS.length}
          </span>
          <span>
            <button onClick={finish}>ข้าม</button>{' '}
            <button data-next onClick={() => (lastStep ? finish() : setI(i + 1))}>
              {lastStep ? 'เริ่มใช้งาน' : 'ถัดไป'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
