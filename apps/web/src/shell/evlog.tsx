// Event log under the map (UI ลูกเล่น รอบ 2): syslog-style lines (time · level · host · message)
// from the 24 h history (M20 `status:history`), newest first, with the 24 h strip in its header.
// Devices out behind a root cause fold into one line. A line opens its device in the 3D view.
import type { StatusHistory, StatusSnapshot } from '@sbc-noc/shared';
import { logLines, timelineBars, type LogLine, type TimelineBar } from './console.js';
import { plainMessage } from './messages.js';
import { hhmm, minutesTxt, type Names } from './panels.js';

const LEVEL_TH: Record<LogLine['level'], string> = {
  down: 'ล่ม',
  warn: 'เตือน',
  ok: 'กลับ',
  sys: 'ระบบ',
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

export function EventLog({
  history,
  snap,
  names,
  now,
  outOf,
  onGo,
}: {
  history: StatusHistory | null | undefined;
  snap: StatusSnapshot | null;
  names: Names;
  now: number;
  /** Devices out behind a root cause, counted like its card. */
  outOf?: (root: string) => number;
  onGo: (code: string) => void;
}) {
  if (!history) return null;
  const { bars, from } = timelineBars(history, now);
  const nm = (b: TimelineBar) => (b.device && names.has(b.device) ? names.name(b.device) : b.host);
  const lines = logLines(history, snap, 60, outOf);
  const today = new Date(now).toDateString();
  const text = (l: LogLine) => {
    if (l.level === 'sys') return `${l.message} แสดงสถานะ ณ ${hhmm(l.at, new Date(now))}`;
    if (l.root) return `ไม่ตอบ อยู่หลัง ${names.name(l.root)} รวมเข้าเหตุเดียวกัน`;
    if (l.level === 'ok')
      return `กลับมาใช้งาน ${l.was === 'down' ? 'ล่ม' : 'ผิดปกติ'}ไป ${minutesTxt(l.outMin ?? 1)}`;
    return plainMessage(l.message);
  };
  return (
    <section className="evlog" aria-label="บันทึกเหตุการณ์" data-testid="event-log">
      <div className="elh">
        <span className="ptitle">บันทึกเหตุการณ์ {history.hours} ชม.</span>
        <div
          className="track"
          role="list"
          data-testid="timeline"
          aria-label={`เหตุการณ์ ${history.hours} ชั่วโมงล่าสุด`}
          title={`${hhmm(new Date(from).toISOString(), new Date(now))} — ตอนนี้`}
        >
          {bars.map((b, k) => (
            <button
              key={`${b.host}:${b.start}:${k}`}
              role="listitem"
              className={`tb ${b.severity}${b.open ? ' open' : ''}`}
              style={{ left: `${b.left}%`, width: `${b.width}%` }}
              title={`${nm(b)} · ${b.severity === 'down' ? 'ใช้งานไม่ได้' : 'ควรตรวจสอบ'} · ${plainMessage(b.message)} · ${b.open ? 'ยังไม่หาย' : `หายแล้ว ${hhmm(b.end as string, new Date(now))}`}`}
              aria-label={`${nm(b)} ${b.severity === 'down' ? 'ใช้งานไม่ได้' : 'ควรตรวจสอบ'}`}
              disabled={!b.device || !names.has(b.device)}
              onClick={() => b.device && onGo(b.device)}
            />
          ))}
        </div>
      </div>
      <ol className="elines mono">
        {lines.map((l, k) => {
          const prev = lines[k - 1];
          const day = new Date(l.at).toDateString();
          const divider =
            day !== today &&
            (!prev || new Date(prev.at).toDateString() !== day || prev.level === 'sys');
          const go = l.device && names.has(l.device) ? l.device : null;
          return (
            <li key={`${l.level}:${l.host}:${l.at}:${k}`}>
              {divider && l.level !== 'sys' && <span className="eday">เมื่อวาน</span>}
              <button
                className={`eline ${l.level}${l.root ? ' fold' : ''}`}
                disabled={!go}
                onClick={() => go && onGo(go)}
                title={go ? `${names.name(go)} · ${names.where(go)}` : undefined}
              >
                <span className="et">{clock(l.at)}</span>
                <span className="el">{LEVEL_TH[l.level]}</span>
                <span className="eh">{l.host}</span>
                <span className="em">{text(l)}</span>
              </button>
            </li>
          );
        })}
        <li className="eprompt" aria-hidden="true">
          noc@sbc:~$ <span className="caret" />
        </li>
      </ol>
    </section>
  );
}
