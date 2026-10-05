// Live feed cards over the scene (new / worse / recovered — click flies there).
import { STATE_ICON } from '@sbc-noc/ui';
import type { FeedEvent } from './events.js';
import type { Names } from './panels.js';

const CHANGE_TH: Record<FeedEvent['change'], string> = {
  new: 'เหตุใหม่',
  worse: 'แย่ลงจนใช้งานไม่ได้',
  ok: 'กลับมาปกติ',
};
const KIND_TH: Record<FeedEvent['kind'], string> = {
  down: 'ใช้งานไม่ได้',
  warn: 'ควรตรวจสอบ',
  ok: 'ปกติ',
};

export function Feed({
  events,
  names,
  onGo,
  onDismiss,
}: {
  events: FeedEvent[];
  names: Names;
  onGo: (code: string) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      id="feed"
      role="log"
      aria-live="polite"
      aria-label="สิ่งที่เพิ่งเปลี่ยน"
      data-testid="feed"
    >
      {events.map((e) => (
        <div key={e.id} className={`fcard ${e.kind}`}>
          <button
            className="fgo"
            onClick={() => {
              onDismiss(e.id);
              if (names.has(e.device)) onGo(e.device);
            }}
            title={names.has(e.device) ? 'ไปที่อุปกรณ์ในภาพ 3D' : 'ยังไม่ระบุที่ตั้งในผัง'}
          >
            <span className={`ficon i ${e.kind}`}>{STATE_ICON[e.kind]}</span>
            <span className="ftext">
              <small>
                {CHANGE_TH[e.change]}
                {e.change === 'new' ? ` · ${KIND_TH[e.kind]}` : ''}
              </small>
              <b>{names.name(e.device)}</b>
              <small>{names.where(e.device)}</small>
            </span>
          </button>
          <button className="fx" aria-label="ปิดการ์ดนี้" onClick={() => onDismiss(e.id)}>
            ×
          </button>
          <i className="flife" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}
