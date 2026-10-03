import {
  applyDelta,
  DEVICE_STATE_TH,
  liveMessageSchema,
  statusSnapshotSchema,
  type StatusSnapshot,
} from '@sbc-noc/shared';
import { useEffect, useRef, useState } from 'react';

export const POLL_MS = 30_000;

type Mode = 'connecting' | 'live' | 'poll';
interface Change {
  at: string;
  text: string;
}

/**
 * M16 test page: live status over WebSocket (/api/status/ws). When the socket is unavailable it
 * falls back to GET /api/status every 30 s and keeps retrying the socket.
 */
export function useLiveStatus(wsUrl: string) {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [mode, setMode] = useState<Mode>('connecting');
  const [changes, setChanges] = useState<Change[]>([]);
  const current = useRef<StatusSnapshot | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const show = (next: StatusSnapshot, text: string | null) => {
      current.current = next;
      setSnapshot(next);
      if (text) {
        setChanges((c) =>
          [{ at: new Date().toLocaleTimeString('th-TH'), text }, ...c].slice(0, 10),
        );
      }
    };
    const fetchOnce = () =>
      fetch('/api/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((body: unknown) => {
          if (body) show(statusSnapshotSchema.parse(body), null);
        })
        .catch(() => undefined);
    const startPolling = () => {
      setMode('poll');
      if (!poll) {
        void fetchOnce();
        poll = setInterval(() => void fetchOnce(), POLL_MS);
      }
    };
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(wsUrl);
      ws.onmessage = (ev: MessageEvent<string>) => {
        const msg = liveMessageSchema.parse(JSON.parse(ev.data));
        if (poll) {
          clearInterval(poll);
          poll = undefined;
        }
        setMode('live');
        if (msg.type === 'snapshot') {
          show(msg.snapshot, null);
        } else if (current.current) {
          const changed = Object.entries(msg.delta.changed).map(
            ([code, st]) => `${code} → ${DEVICE_STATE_TH[st]}`,
          );
          show(applyDelta(current.current, msg.delta), changed.length ? changed.join(', ') : null);
        }
      };
      ws.onclose = () => {
        if (closed) return;
        startPolling();
        retry = setTimeout(connect, POLL_MS);
      };
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
      if (poll) clearInterval(poll);
      if (retry) clearTimeout(retry);
    };
  }, [wsUrl]);

  return { snapshot, mode, changes };
}

const MODE_TH: Record<Mode, string> = {
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
