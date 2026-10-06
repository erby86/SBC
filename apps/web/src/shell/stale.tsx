// "Data is not fresh" band (UI ลูกเล่น รอบ 2, canvas sheet 4): one band across the console that
// names why the numbers below may be old. Grey with diagonal hatching, never the device red.
import type { LinkState } from '../data/live.js';
import { Icon } from './icons.js';

/** Why the screen is not live: this computer, the NOC server, or Zabbix behind it. */
export type StaleCause = 'offline' | 'server' | 'zabbix';

export function staleCause(input: {
  online: boolean;
  link: LinkState;
  stale: boolean | undefined;
}): StaleCause | null {
  if (!input.online) return 'offline';
  if (input.link === 'down') return 'server';
  if (input.stale) return 'zabbix';
  return null;
}

export const STALE_TEXT: Record<StaleCause, { title: string; detail: (tries: number) => string }> =
  {
    offline: {
      title: 'เครื่องนี้ออฟไลน์',
      detail: () => 'ตรวจสาย LAN หรือ Wi-Fi ของเครื่องนี้ เซิร์ฟเวอร์อาจยังทำงานปกติ',
    },
    server: {
      title: 'เชื่อมต่อเซิร์ฟเวอร์ NOC ไม่ได้',
      detail: (tries) =>
        `ลองใหม่เองทุก 30 วินาที${tries > 0 ? ` ครั้งที่ ${tries}` : ''} ตัวเลขด้านล่างเป็นของรอบล่าสุดที่ได้`,
    },
    zabbix: {
      title: 'Zabbix ไม่ส่งข้อมูลใหม่',
      detail: () => 'ระบบเฝ้าเองอาจมีปัญหา ตัวเลขทั้งหน้าเป็นของเวลาด้านขวา',
    },
  };

/** "เมื่อ … ที่แล้ว" for the last good data (the console clock ticks every 30 s). */
export function sinceText(iso: string | undefined, now: number): string {
  if (!iso) return 'ยังไม่เคยได้ข้อมูล';
  const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (min < 1) return 'ไม่ถึง 1 นาทีที่แล้ว';
  if (min < 120) return `${min} นาทีที่แล้ว`;
  return `${Math.floor(min / 60)} ชั่วโมงที่แล้ว`;
}

export function StaleBand(props: {
  cause: StaleCause;
  lastUpdate: string | undefined;
  lastTime: string | null;
  now: number;
  tries: number;
  zabbixHome: string | null;
  onRetry: () => void;
}) {
  const t = STALE_TEXT[props.cause];
  return (
    <section id="staleBand" role="alert" data-testid="stale-band" data-cause={props.cause}>
      <Icon name="clock" className="sb-icon" />
      <div className="sb-text">
        <b>{t.title}</b>
        <span>{t.detail(props.tries)}</span>
      </div>
      <span className="sb-age">
        ข้อมูลล่าสุด {props.lastTime ?? '—'} <b>{sinceText(props.lastUpdate, props.now)}</b>
      </span>
      {props.cause === 'zabbix' ? (
        props.zabbixHome && (
          <a className="sb-btn" href={props.zabbixHome} target="_blank" rel="noreferrer">
            เปิด Zabbix
          </a>
        )
      ) : (
        <button className="sb-btn" onClick={props.onRetry}>
          ลองเชื่อมต่อตอนนี้
        </button>
      )}
    </section>
  );
}
