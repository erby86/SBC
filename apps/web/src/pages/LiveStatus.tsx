import { useLiveStatus, type LiveMode } from '../data/live.js';

export { POLL_MS } from '../data/live.js';

const MODE_TH: Record<LiveMode, string> = {
  connecting: 'กำลังเชื่อมต่อ…',
  live: 'สด (WebSocket)',
  poll: 'ดึงทุก 30 วินาที (WebSocket ใช้ไม่ได้)',
};

export function LiveStatus({ wsUrl }: { wsUrl: string }) {
  const { snapshot, mode, changes } = useLiveStatus(wsUrl);
  return (
    <section aria-labelledby="live-title">
      <h2 id="live-title">สถานะเครือข่าย (ทดสอบ M16)</h2>
      <p data-testid="live-mode">การเชื่อมต่อ: {MODE_TH[mode]}</p>
      {!snapshot ? (
        <p>ยังไม่มีสถานะ</p>
      ) : (
        <>
          <p data-testid="live-fresh">
            {snapshot.stale ? '⏸ ข้อมูลค้าง — ' : ''}อัปเดตจาก Zabbix ล่าสุด{' '}
            {new Date(snapshot.lastUpdate).toLocaleTimeString('th-TH')}
          </p>
          <p data-testid="live-counts">
            ปกติ {snapshot.counts.ok} · เตือน {snapshot.counts.warn} · ล่ม {snapshot.counts.down} ·
            ขาดจากต้นทาง {snapshot.counts.cut} · บำรุงรักษา {snapshot.counts.maint}
          </p>
          <ul data-testid="live-incidents">
            {snapshot.incidents.map((i) => (
              <li key={i.device}>
                {i.severity === 'down' ? '✕' : '▲'} {i.device}: {i.message}
                {i.impacted ? ` (กระทบ ${i.impacted})` : ''}
                {i.ack ? ` — รับเรื่องแล้ว (${i.ack.by})` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
      {changes.length > 0 && (
        <details open>
          <summary>การเปลี่ยนแปลงล่าสุด</summary>
          <ul data-testid="live-changes">
            {changes.map((c, n) => (
              <li key={n}>
                {c.at} {c.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
